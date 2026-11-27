import {
  IN_REVIEW_BY_CONCEPT,
  QUEUE_GROUPS,
  REVIEWED_ORAL_SCREENING_CONCEPT,
  readObs,
  type QueueGroup,
} from "@/constants/tanuhConcepts";
import { format, isSameDay } from "date-fns";
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

/**
 * The physician's own tie order for the day (PE-304): the groups rotated by a hash of the username and the local date,
 * so physicians' first groups are spread over the three (two can still share one on a given day), and each one's first
 * group changes from day to day. Before,
 * ties always went FLW marked first, and every physician's first case of the day was an FLW marked one.
 */
export function groupOrderFor(viewer: string, now: Date): QueueGroup[] {
  let hash = 0x811c9dc5;
  for (const ch of `${viewer}|${format(now, "yyyy-MM-dd")}`) {
    hash ^= ch.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const offset = hash % QUEUE_GROUPS.length;
  return [...QUEUE_GROUPS.slice(offset), ...QUEUE_GROUPS.slice(0, offset)];
}

// Fewest reviewed today first, ties in the physician's `order` (groupOrderFor); skips a group with nothing waiting.
export function chooseGroup(reviewed: GroupCounts, waiting: GroupCounts, order: readonly QueueGroup[]): QueueGroup | null {
  const ordered = [...order].sort((a, b) => reviewed[a] - reviewed[b]);
  return ordered.find((g) => waiting[g] > 0) ?? null;
}

// The panel's line on which group the button takes from next (FW13: "an" before a vowel).
export function nextCaseLine(next: QueueGroup | null): string {
  if (!next) return "No cases are waiting for review.";
  return `Next case will be ${/^[aeiou]/i.test(next) ? "an" : "a"} ${next} case.`;
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
 * The next group and the case to continue, as the panel shows them, leaving out the cases the last press passed over
 * (refused or failed). A light refresh still lists such a case, for instance one refused because its screening has a
 * review the queue's read missed, and a press would only be refused on it again. The next press reads the queue in
 * full and tries every case afresh.
 */
export function nextAndHeld(
  rows: QueueRow[],
  reviewed: GroupCounts,
  passedOver: ReadonlySet<string>,
  viewer: string,
  now: Date,
): { next: QueueGroup | null; held: QueueRow | undefined } {
  const left = passedOver.size > 0 ? rows.filter((r) => !passedOver.has(queueRowKey(r))) : rows;
  return {
    next: chooseGroup(reviewed, waitingCounts(left, viewer, now), groupOrderFor(viewer, now)),
    held: heldByViewer(left, viewer, now),
  };
}

/**
 * Review next case (PE-249): the oldest waiting case of the group chosen by `chooseGroup`, taken with `take`. A refused
 * case moves on to the next waiting case of that group; a group whose cases are all refused is set aside and the group
 * is chosen again from the rest. `held`, the case the viewer already holds, is taken again first, so Continue case
 * renews the hold before the page opens (FW12); when it cannot be, the press goes on to the waiting cases. A case whose
 * take fails is logged and passed over like a refusal, so one broken case cannot stop every press (FW1). The taken
 * review's uuid; null once every candidate is refused; one error when nothing was taken and at least one take failed.
 * The keys of the cases refused or failed go into `passedOver`, when given, for `nextAndHeld`.
 */
export async function takeNextCase(
  rows: QueueRow[],
  reviewed: GroupCounts,
  viewer: string,
  now: Date,
  take: (row: QueueRow) => Promise<TakeResult>,
  held?: QueueRow,
  passedOver?: Set<string>,
): Promise<string | null> {
  let failures = 0;
  let firstFailure: unknown;
  const attempt = async (row: QueueRow): Promise<string | null> => {
    try {
      const result = await take(row);
      if ("reviewUuid" in result) return result.reviewUuid;
      passedOver?.add(queueRowKey(row));
      return null;
    } catch (err) {
      console.error(`Review next case: could not take case ${queueRowKey(row)}`, err);
      passedOver?.add(queueRowKey(row));
      failures += 1;
      firstFailure ??= err;
      return null;
    }
  };

  if (held) {
    const renewed = await attempt(held);
    if (renewed) return renewed;
  }
  const tried = new Set<string>(held ? [queueRowKey(held)] : []);
  const untried = () => rows.filter((r) => !tried.has(queueRowKey(r)));
  const waiting: GroupCounts = { ...waitingCounts(rows, viewer, now) };
  const order = groupOrderFor(viewer, now);
  for (let group = chooseGroup(reviewed, waiting, order); group; group = chooseGroup(reviewed, waiting, order)) {
    for (let row = nextCaseIn(untried(), group, viewer, now); row; row = nextCaseIn(untried(), group, viewer, now)) {
      tried.add(queueRowKey(row));
      const reviewUuid = await attempt(row);
      if (reviewUuid) return reviewUuid;
    }
    waiting[group] = 0;
  }
  if (failures > 0) {
    throw new Error(`Could not take ${failures === 1 ? "a case" : `${failures} cases`}`, { cause: firstFailure });
  }
  return null;
}
