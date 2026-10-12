import { ENCOUNTER_TYPE, REVIEW_CATEGORY_VALUES, WORKER_OPINION, readModelStatus, readReviewCategory } from "@/constants/tanuhConcepts";
import { addressChain, patientsInLocation } from "./address";
import {
  isCompleted,
  isProgramEncounter,
  isScreeningReviewed,
  pairBookedReviewToScreening,
  type CachedEncounter,
} from "./encounters";
import { getEncounterUuidsInLocation, type EncounterWithLocation } from "./impl";
import { readSubjects } from "./programList";
import type { SubjectApiResponse } from "./types";

// tanuh-webapp#4. The pending tab, where the organisation has the high-risk model: every booked review still waiting,
// and every screening the model sent for review that nobody has reviewed. EncounterWithLocation is shaped around a
// review and stays for the completed tab.
export type PendingRow =
  | { kind: "booked"; review: EncounterWithLocation; screening?: CachedEncounter; group?: string }
  | { kind: "screening"; screening: CachedEncounter; group: string };

export function pendingRowSubjectId(row: PendingRow): string {
  return row.kind === "booked" ? row.review.subject.uuid : row.screening["Subject ID"];
}

export function pendingRowKey(row: PendingRow): string {
  return row.kind === "booked" ? row.review.encounterUuid : row.screening.ID;
}

export function selectPendingRows(
  booked: EncounterWithLocation[],
  screenings: CachedEncounter[],
  reviews: CachedEncounter[],
): PendingRow[] {
  const reviewsById = new Map(reviews.map((r) => [r.ID, r]));
  const pairedScreeningIds = new Set<string>();
  const rows: PendingRow[] = booked.map((review) => {
    const stored = reviewsById.get(review.encounterUuid);
    const screening = stored ? pairBookedReviewToScreening(stored, screenings) : undefined;
    if (screening) pairedScreeningIds.add(screening.ID);
    return { kind: "booked", review, screening, group: screening ? readReviewCategory(screening.observations ?? {}) : undefined };
  });
  for (const screening of screenings) {
    const obs = screening.observations ?? {};
    const group = readReviewCategory(obs);
    if (!isCompleted(screening) || !readModelStatus(obs) || !group || group === REVIEW_CATEGORY_VALUES.closed) continue;
    if (pairedScreeningIds.has(screening.ID) || isScreeningReviewed(screening, reviews)) continue;
    rows.push({ kind: "screening", screening, group });
  }
  return rows;
}

// A deleted patient's rows go. A row whose patient could not be read stays, without the patient's details, and so does
// one not read yet: the list reads patients for the rows on screen only (tanuh-webapp#4 review), so a deleted patient's
// row leaves the list, and its count, once it has been on screen.
export function withoutDeletedPatients(
  rows: PendingRow[],
  subjects: ReadonlyMap<string, SubjectApiResponse | null>,
): PendingRow[] {
  return rows.filter((row) => !subjects.get(pendingRowSubjectId(row))?.Voided);
}

export function buildPendingRows(
  booked: EncounterWithLocation[],
  screenings: CachedEncounter[],
  reviews: CachedEncounter[],
  subjects: ReadonlyMap<string, SubjectApiResponse | null>,
): PendingRow[] {
  return withoutDeletedPatients(selectPendingRows(booked, screenings, reviews), subjects);
}

// What the patient-location filter knows about the screening rows (tanuh-webapp#4 review).
export interface PatientLocationMatch {
  // The screenings the server placed in the location, and whether that read finished.
  inLocation: ReadonlySet<string>;
  complete: boolean;
  // For a screening the server cannot place, one recorded inside a program: the location's address chain, and the
  // patient, null where the read failed.
  chain: Record<string, string>;
  subjects: ReadonlyMap<string, SubjectApiResponse | null>;
}

// A booked review was narrowed by the server already. A screening stays when the server placed it in the location, or,
// recorded inside a program, when its patient's address is in the location. A screening that could not be checked
// stays, and is returned in `unchecked`, so the filtered list never loses a case without saying so: before, a patient
// read that failed dropped its row silently.
export function filterByPatientLocation(
  rows: PendingRow[],
  match: PatientLocationMatch,
): { rows: PendingRow[]; unchecked: Set<string> } {
  const programPatients = rows.flatMap((r) =>
    r.kind === "screening" && isProgramEncounter(r.screening) ? [r.screening["Subject ID"]] : [],
  );
  const placed = patientsInLocation(programPatients, match.subjects, match.chain);
  const unchecked = new Set<string>();
  const kept = rows.filter((row) => {
    if (row.kind === "booked") return true;
    if (isProgramEncounter(row.screening)) {
      if (placed.unplaced.has(row.screening["Subject ID"])) unchecked.add(row.screening.ID);
      return placed.kept.has(row.screening["Subject ID"]);
    }
    if (match.inLocation.has(row.screening.ID)) return true;
    if (match.complete) return false;
    unchecked.add(row.screening.ID);
    return true;
  });
  return { rows: kept, unchecked };
}

// The reads behind filterByPatientLocation: a server lookup for the standalone screenings, made only when there are
// some, and patient reads only for screenings recorded inside a program, which that lookup cannot place.
export async function matchPatientLocation(rows: PendingRow[], locationUuid: string): Promise<PatientLocationMatch> {
  const screenings = rows.flatMap((r) => (r.kind === "screening" ? [r.screening] : []));
  const programPatients = screenings.filter(isProgramEncounter).map((s) => s["Subject ID"]);
  const [{ uuids, complete }, chain, subjects] = await Promise.all([
    screenings.some((s) => !isProgramEncounter(s))
      ? getEncounterUuidsInLocation(ENCOUNTER_TYPE.oralScreening.name, "completed", locationUuid)
      : Promise.resolve({ uuids: new Set<string>(), complete: true }),
    programPatients.length > 0 ? addressChain(locationUuid) : Promise.resolve({}),
    readSubjects(programPatients),
  ]);
  return { inLocation: uuids, complete, chain, subjects };
}

// The rows on one page of the list; both tabs page in the browser.
export function rowsOnPage<T>(rows: readonly T[], page: number, pageSize: number): T[] {
  return rows.slice(page * pageSize, (page + 1) * pageSize);
}

// The patients to read for the rows on screen, each once, leaving out those already read (tanuh-webapp#4 review). A
// failed read (null) counts as read until the list reloads, so a patient the server keeps refusing is not asked for
// again on every render.
export function patientsToRead(rows: readonly { subjectId: string }[], known: ReadonlyMap<string, unknown>): string[] {
  return [...new Set(rows.map((r) => r.subjectId))].filter((id) => !known.has(id));
}

// High Risk, then FLW override, then Low Risk with Not scored, then Safety sample. A booked review whose screening has
// no group, or was closed, ranks with Low Risk.
export const QUEUE_ORDER: Record<string, number> = {
  [REVIEW_CATEGORY_VALUES.highRisk]: 0,
  [REVIEW_CATEGORY_VALUES.flwOverride]: 1,
  [REVIEW_CATEGORY_VALUES.lowRisk]: 2,
  [REVIEW_CATEGORY_VALUES.notScored]: 2,
  [REVIEW_CATEGORY_VALUES.safetySample]: 3,
};
const DEFAULT_RANK = QUEUE_ORDER[REVIEW_CATEGORY_VALUES.lowRisk];

function rankOf(row: PendingRow): number {
  return (row.group !== undefined ? QUEUE_ORDER[row.group] : undefined) ?? DEFAULT_RANK;
}

export function pendingRowDate(row: PendingRow): string {
  if (row.screening?.["Encounter date time"]) return row.screening["Encounter date time"];
  return row.kind === "booked" ? (row.review.earliestScheduledDate ?? "") : "";
}

function opinionRank(row: PendingRow): number {
  const opinion = row.screening?.workerOpinion;
  return opinion === WORKER_OPINION.suspicious ? 0 : opinion === WORKER_OPINION.notSuspicious ? 1 : 2;
}

export type PendingSort = "group" | "date" | "opinion";

// By group: the queue order, oldest first. By date: newest screening first, as the list was before. By opinion: the
// worker's suspicious cases first, then the queue order.
export function sortPendingRows(rows: PendingRow[], sort: PendingSort): PendingRow[] {
  const byQueue = (a: PendingRow, b: PendingRow) => rankOf(a) - rankOf(b) || pendingRowDate(a).localeCompare(pendingRowDate(b));
  const compare =
    sort === "date"
      ? (a: PendingRow, b: PendingRow) => pendingRowDate(b).localeCompare(pendingRowDate(a))
      : sort === "opinion"
        ? (a: PendingRow, b: PendingRow) => opinionRank(a) - opinionRank(b) || byQueue(a, b)
        : byQueue;
  return [...rows].sort(compare);
}

export type GroupFilter = "all" | "high-risk" | "low-risk" | "flw-override" | "safety-sample" | "not-scored";
const FILTER_GROUP: Record<Exclude<GroupFilter, "all">, string> = {
  "high-risk": REVIEW_CATEGORY_VALUES.highRisk,
  "low-risk": REVIEW_CATEGORY_VALUES.lowRisk,
  "flw-override": REVIEW_CATEGORY_VALUES.flwOverride,
  "safety-sample": REVIEW_CATEGORY_VALUES.safetySample,
  "not-scored": REVIEW_CATEGORY_VALUES.notScored,
};

export function filterPendingRows(rows: PendingRow[], filter: GroupFilter): PendingRow[] {
  return filter === "all" ? rows : rows.filter((row) => row.group === FILTER_GROUP[filter]);
}
