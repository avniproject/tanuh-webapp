import { REVIEW_CATEGORY_VALUES, WORKER_OPINION, readModelStatus, readReviewCategory } from "@/constants/tanuhConcepts";
import { isCompleted, isScreeningReviewed, pairBookedReviewToScreening, type CachedEncounter } from "./encounters";
import type { EncounterWithLocation } from "./impl";
import type { SubjectApiResponse } from "./types";

// tanuh-webapp#4. The pending tab, where the organisation has the high-risk model: every booked review still waiting,
// and every screening the model sent for review that nobody has reviewed. EncounterWithLocation is shaped around a
// review and stays for the completed tab.
export type PendingRow =
  | { kind: "booked"; review: EncounterWithLocation; screening?: CachedEncounter; group?: string; subject?: SubjectApiResponse | null }
  | { kind: "screening"; screening: CachedEncounter; group: string; subject?: SubjectApiResponse | null };

export function pendingRowSubjectId(row: PendingRow): string {
  return row.kind === "booked" ? row.review.subject.uuid : row.screening["Subject ID"];
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

// A deleted patient's rows go; a row whose patient could not be read stays, without the patient's details.
export function withSubjects(rows: PendingRow[], subjects: Map<string, SubjectApiResponse | null>): PendingRow[] {
  return rows
    .map((row) => ({ ...row, subject: subjects.get(pendingRowSubjectId(row)) ?? null }))
    .filter((row) => !row.subject?.Voided);
}

export function buildPendingRows(
  booked: EncounterWithLocation[],
  screenings: CachedEncounter[],
  reviews: CachedEncounter[],
  subjects: Map<string, SubjectApiResponse | null>,
): PendingRow[] {
  return withSubjects(selectPendingRows(booked, screenings, reviews), subjects);
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
