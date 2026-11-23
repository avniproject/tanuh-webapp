import {
  PLACE_OF_REFERRAL_CONCEPT,
  QUEUE_GROUPS,
  REVIEWED_ORAL_SCREENING_CONCEPT,
  WORKER_OPINION,
  readObs,
  type QueueGroup,
} from "@/constants/tanuhConcepts";
import { inSubtree } from "./address";
import { classify, isReady, signalsOf, type CaseClass } from "./caseSignals";
import { holdStatus, type HoldStatus } from "./caseHold";
import {
  groupBySubjectAndEnrolment,
  isCompleted,
  pairBookedReviewToScreening,
  screeningsByReview,
  type CachedEncounter,
} from "./encounters";
import type { EncounterWithLocation } from "./impl";

// One row of the review queue (PE-249): a booked review, or a ready screening that the queue read has no booked
// review for. A screening row's `stored` is the planned review made for it when a physician took it (FW7), which the
// queue's booked read has not seen yet.
export type QueueRow =
  | {
      kind: "booked";
      review: EncounterWithLocation;
      stored?: CachedEncounter;
      screening?: CachedEncounter;
      cls?: CaseClass;
    }
  | { kind: "screening"; screening: CachedEncounter; cls: CaseClass; stored?: CachedEncounter };

export type QueueGroupFilter = "all" | "flw" | "ai" | "safety";
export type QueueSort = "group" | "date" | "opinion";

export const QUEUE_GROUP_ORDER: Record<QueueGroup, number> = Object.fromEntries(
  QUEUE_GROUPS.map((g, i) => [g, i]),
) as Record<QueueGroup, number>;

const GROUP_OF_FILTER: Record<Exclude<QueueGroupFilter, "all">, QueueGroup> = {
  flw: "FLW marked",
  ai: "AI marked",
  safety: "Safety sample",
};

// The screenings a completed review covers, by the rule the list already uses, worked out one patient-and-enrolment
// scope at a time.
function reviewedScreeningIds(reviews: CachedEncounter[], screenings: CachedEncounter[]): Set<string> {
  const reviewsByScope = groupBySubjectAndEnrolment(reviews.filter((r) => !r.Voided));
  const screeningsByScope = groupBySubjectAndEnrolment(screenings);
  const ids = new Set<string>();
  for (const [scope, scopeReviews] of Object.entries(reviewsByScope)) {
    const paired = screeningsByReview(scopeReviews, screeningsByScope[scope] ?? []);
    for (const r of scopeReviews) {
      const s = paired.get(r.ID);
      if (s && isCompleted(r)) ids.add(s.ID);
    }
  }
  return ids;
}

// A review still open: not completed, cancelled or deleted.
export const isPlanned = (r: CachedEncounter): boolean =>
  !r["Encounter date time"] && !r["Cancel date time"] && !r.Voided;

// Each screening's open review, made when a physician took the case, by the screening it is stamped with. Read once
// per call, not once per screening; with two for one screening, the first in the store's order.
function plannedReviewsByScreening(reviews: CachedEncounter[]): Map<string, CachedEncounter> {
  const byScreening = new Map<string, CachedEncounter>();
  for (const r of reviews) {
    if (!isPlanned(r)) continue;
    const stamp = readObs<string>(r.observations ?? {}, REVIEWED_ORAL_SCREENING_CONCEPT);
    if (typeof stamp === "string" && !byScreening.has(stamp)) byScreening.set(stamp, r);
  }
  return byScreening;
}

const createdOf = (row: Extract<QueueRow, { kind: "booked" }>): number => {
  const t = Date.parse(row.stored?.audit?.["Created at"] ?? row.review.earliestScheduledDate ?? "");
  return Number.isNaN(t) ? Infinity : t;
};

export function selectQueueRows(
  booked: EncounterWithLocation[],
  screenings: CachedEncounter[],
  reviews: CachedEncounter[],
  viewer = "",
  now: Date = new Date(),
): QueueRow[] {
  const liveScreenings = screenings.filter((s) => isCompleted(s) && !s.Voided);
  const reviewed = reviewedScreeningIds(reviews, liveScreenings);

  const bookedRows: Extract<QueueRow, { kind: "booked" }>[] = booked.map((review) => {
    const stored = reviews.find((r) => r.ID === review.encounterUuid);
    const screening = stored ? (pairBookedReviewToScreening(stored, liveScreenings) as CachedEncounter | undefined) : undefined;
    return { kind: "booked", review, stored, screening, cls: screening ? classify(signalsOf(screening)) : undefined };
  });

  const paired = new Set(bookedRows.flatMap((r) => (r.screening ? [r.screening.ID] : [])));
  const best = new Map<string, Extract<QueueRow, { kind: "booked" }>>();
  const rows: QueueRow[] = [];
  for (const row of bookedRows) {
    if (!row.screening) {
      rows.push(row);
      continue;
    }
    if (reviewed.has(row.screening.ID)) continue;
    const cur = best.get(row.screening.ID);
    if (!cur) {
      best.set(row.screening.ID, row);
      continue;
    }
    const live = (r: typeof row) => holdStatus(r.stored, viewer, now).kind !== "waiting";
    const winner = live(row) !== live(cur) ? (live(row) ? row : cur) : createdOf(row) < createdOf(cur) ? row : cur;
    best.set(row.screening.ID, winner);
  }
  rows.push(...best.values());

  const planned = plannedReviewsByScreening(reviews);
  for (const s of liveScreenings) {
    if (paired.has(s.ID) || reviewed.has(s.ID)) continue;
    const cls = classify(signalsOf(s));
    if (isReady(cls)) rows.push({ kind: "screening", screening: s, cls, stored: planned.get(s.ID) });
  }
  return rows;
}

export const queueRowKey = (row: QueueRow): string => (row.kind === "booked" ? row.review.encounterUuid : row.screening.ID);

export const queueRowSubjectId = (row: QueueRow): string =>
  row.kind === "booked" ? row.review.subject.uuid : row.screening["Subject ID"];

export function queueRowDate(row: QueueRow): string {
  const screening = row.screening;
  if (screening) return screening["Encounter date time"] ?? "";
  return row.kind === "booked" ? (row.review.earliestScheduledDate ?? "") : "";
}

export function rowReason(row: QueueRow): QueueGroup | "OCSHR pending" | undefined {
  if (!row.cls) return undefined;
  return row.cls.ocshrPending ? "OCSHR pending" : row.cls.group;
}

// Who holds the case, from its review: a booked row's own, or the one made for a screening row when it was taken.
export function rowHoldStatus(row: QueueRow, viewer: string, now: Date): HoldStatus {
  return holdStatus(row.stored, viewer, now);
}

const groupRank = (row: QueueRow): number => {
  const r = rowReason(row);
  return r && r !== "OCSHR pending" ? QUEUE_GROUP_ORDER[r] : QUEUE_GROUPS.length;
};
const opinionRank = (row: QueueRow): number => {
  const o = row.screening?.workerOpinion;
  return o === WORKER_OPINION.suspicious ? 0 : o === WORKER_OPINION.notSuspicious ? 1 : 2;
};
const byDate = (a: QueueRow, b: QueueRow) => queueRowDate(a).localeCompare(queueRowDate(b));

export function sortQueueRows(rows: QueueRow[], sort: QueueSort): QueueRow[] {
  const out = [...rows];
  if (sort === "date") return out.sort((a, b) => byDate(b, a));
  if (sort === "opinion") return out.sort((a, b) => opinionRank(a) - opinionRank(b) || groupRank(a) - groupRank(b));
  return out.sort((a, b) => groupRank(a) - groupRank(b) || byDate(a, b));
}

export function filterQueueRows(rows: QueueRow[], filter: QueueGroupFilter): QueueRow[] {
  if (filter === "all") return rows;
  return rows.filter((r) => rowReason(r) === GROUP_OF_FILTER[filter]);
}

export interface QueueNarrowing {
  // The booked reviews the list's own filtered read returned; null when no place or referral facility is chosen.
  bookedListed: ReadonlySet<string> | null;
  // The chosen place and every covered place below it; null when no place is chosen.
  placesUnder: ReadonlySet<string> | null;
  // The chosen referral facility's place chain; null when none is chosen.
  referralChain: Record<string, string> | null;
  // The screening rows' patients, by subject uuid.
  subjects: ReadonlyMap<string, { "Location ID"?: string }>;
}

// The list's location and referral filters over the queue's rows (PE-249). The server's filtered read decides a booked
// row; a screening row goes by its patient's place and by its own place of referral, as the old list did.
export function narrowQueueRows(rows: QueueRow[], n: QueueNarrowing): QueueRow[] {
  return rows.filter((row) => {
    if (row.kind === "booked") return !n.bookedListed || n.bookedListed.has(row.review.encounterUuid);
    if (n.placesUnder) {
      const at = n.subjects.get(row.screening["Subject ID"])?.["Location ID"];
      if (!at || !n.placesUnder.has(at)) return false;
    }
    return !n.referralChain || inSubtree(row.screening.observations?.[PLACE_OF_REFERRAL_CONCEPT.name], n.referralChain);
  });
}
