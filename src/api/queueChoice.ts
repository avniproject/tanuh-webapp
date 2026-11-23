import {
  IN_REVIEW_BY_CONCEPT,
  QUEUE_GROUPS,
  REVIEWED_ORAL_SCREENING_CONCEPT,
  readObs,
  type QueueGroup,
} from "@/constants/tanuhConcepts";
import { isSameDay } from "date-fns";
import { classify, isReady, signalsOf } from "./caseSignals";
import type { CachedEncounter } from "./encounters";
import type { TakeResult } from "./caseHold";
import { queueRowDate, queueRowKey, rowHoldStatus, rowReason, type QueueRow } from "./queueRows";

export type GroupCounts = Record<QueueGroup, number>;

const zeroCounts = (): GroupCounts => ({ "FLW marked": 0, "AI marked": 0, "Safety sample": 0 });

const isReadyRow = (row: QueueRow): boolean => !!row.cls && isReady(row.cls);

const oldest = (rows: QueueRow[]): QueueRow | undefined =>
  [...rows].sort((a, b) => queueRowDate(a).localeCompare(queueRowDate(b)))[0];

// Ready cases nobody holds, counted per group (PE-249). A case the viewer holds is not waiting.
export function waitingCounts(rows: QueueRow[], viewer: string, now: Date): GroupCounts & { total: number } {
  const counts = zeroCounts();
  let total = 0;
  for (const row of rows) {
    if (!isReadyRow(row) || rowHoldStatus(row, viewer, now).kind !== "waiting") continue;
    const group = row.cls?.group;
    if (!group) continue;
    counts[group] += 1;
    total += 1;
  }
  return { ...counts, total };
}

// The viewer's finished reviews today, by the group of the screening each one covers.
export function reviewedToday(
  reviews: CachedEncounter[],
  screenings: CachedEncounter[],
  viewer: string,
  now: Date,
): GroupCounts {
  const counts = zeroCounts();
  const byId = new Map(screenings.map((s) => [s.ID, s]));
  for (const r of reviews) {
    const done = r["Encounter date time"];
    if (r.Voided || !done || !isSameDay(new Date(done), now)) continue;
    const obs = r.observations ?? {};
    if (readObs<string>(obs, IN_REVIEW_BY_CONCEPT) !== viewer) continue;
    const stamp = readObs<string>(obs, REVIEWED_ORAL_SCREENING_CONCEPT);
    const screening = stamp ? byId.get(stamp) : undefined;
    const group = screening ? classify(signalsOf(screening)).group : undefined;
    if (group) counts[group] += 1;
  }
  return counts;
}

// Fewest reviewed today first, ties in group order; skips a group with nothing waiting.
export function chooseGroup(reviewed: GroupCounts, waiting: GroupCounts): QueueGroup | null {
  const ordered = [...QUEUE_GROUPS].sort((a, b) => reviewed[a] - reviewed[b]);
  return ordered.find((g) => waiting[g] > 0) ?? null;
}

export function nextCaseIn(rows: QueueRow[], group: QueueGroup, viewer: string, now: Date): QueueRow | undefined {
  return oldest(
    rows.filter((r) => isReadyRow(r) && rowReason(r) === group && rowHoldStatus(r, viewer, now).kind === "waiting"),
  );
}

export function heldByViewer(rows: QueueRow[], viewer: string, now: Date): QueueRow | undefined {
  return oldest(rows.filter((r) => rowHoldStatus(r, viewer, now).kind === "mine"));
}

/**
 * Review next case (PE-249): the oldest waiting case of the group chosen by `chooseGroup`, taken with `take`. A refused
 * case moves on to the next waiting case of that group; a group whose cases are all refused is set aside and the group
 * is chosen again from the rest. The taken review's uuid, or null once every candidate is refused. Errors go to the
 * caller.
 */
export async function takeNextCase(
  rows: QueueRow[],
  reviewed: GroupCounts,
  viewer: string,
  now: Date,
  take: (row: QueueRow) => Promise<TakeResult>,
): Promise<string | null> {
  const tried = new Set<string>();
  const untried = () => rows.filter((r) => !tried.has(queueRowKey(r)));
  const waiting: GroupCounts = { ...waitingCounts(rows, viewer, now) };
  for (let group = chooseGroup(reviewed, waiting); group; group = chooseGroup(reviewed, waiting)) {
    for (let row = nextCaseIn(untried(), group, viewer, now); row; row = nextCaseIn(untried(), group, viewer, now)) {
      tried.add(queueRowKey(row));
      const result = await take(row);
      if ("reviewUuid" in result) return result.reviewUuid;
    }
    waiting[group] = 0;
  }
  return null;
}
