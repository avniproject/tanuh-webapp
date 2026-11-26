// Which worker-period row, and which taluk, a dashboard link means. Nothing here scores:
// each function picks among rows DQS returned.
//
// A worker filed under two taluks in one period has a score row for each, told apart by the
// peer group, which the URL carries as `group`. `groupOf` is a peer group key as the URL
// carries it, `rowKey` names one worker-period row and `workerLink` is the Workers view's URL
// parameters that open one. `periodOf` picks the worker's score in
// one peer group from the worker score route, and `historyOf` keeps one point per period of
// the worker's history. `busiestTaluk` is the taluk where a rule failed most, from the rule's
// workers. `banded` is a band's workers ordered by TrustIndex, as DQS's workers route orders
// them.

import type { Band, HistoryPoint, RuleWorkersPage, WorkerPeriod, WorkerRow } from "./api/types";

// A peer group key as it is carried in the URL's `group`.
export const groupOf = (key: number | null) => (key == null ? null : String(key));
export const rowKey = (workerId: string, group: string | null) => `${workerId}|${group ?? ""}`;
export const workerLink = (row: { worker_id: string; peer_group_key: number | null }) => ({
  worker: row.worker_id,
  group: groupOf(row.peer_group_key),
});

// The worker's score for the period in the peer group `group`. Without a group, the one with
// no peer group or else the first.
export function periodOf(periods: WorkerPeriod[], group: string | null): WorkerPeriod | null {
  const own = periods.find((one) => groupOf(one.peer_group_key) === group);
  return own ?? (group == null ? periods[0] ?? null : null);
}

// One point for each period of the worker's history: the one in the peer group `group` where
// the worker has one there, else the period's first.
export function historyOf(points: HistoryPoint[], group: string | null): HistoryPoint[] {
  const kept = new Map<string, HistoryPoint>();
  for (const point of points) {
    const held = kept.get(point.period_start);
    if (!held || (groupOf(held.peer_group_key) !== group && groupOf(point.peer_group_key) === group))
      kept.set(point.period_start, point);
  }
  return [...kept.values()];
}

// The taluk with the most failures among the workers on a page of a rule's workers, or, for a
// rule scored on a measurement that records no failures, the most workers who lost score on
// it; ties go to the lower taluk id. Null when no listed worker is filed under a taluk.
export function busiestTaluk(page: RuleWorkersPage): string | null {
  const totals = new Map<string, [number, number]>();
  for (const one of page.workers) {
    if (!one.taluk_id) continue;
    const [failures, workers] = totals.get(one.taluk_id) ?? [0, 0];
    totals.set(one.taluk_id, [failures + one.n_violations, workers + 1]);
  }
  let best: [string, number, number] | null = null;
  for (const [taluk, [failures, workers]] of [...totals].sort(([a], [b]) => a.localeCompare(b)))
    if (!best || failures > best[1] || (failures === best[1] && workers > best[2])) best = [taluk, failures, workers];
  return best ? best[0] : null;
}

// The first `count` workers of `rows` in band `band`, lowest TrustIndex first for the Low band
// and highest first otherwise. The sort is stable, so workers with equal scores keep DQS's
// order, which is the order the workers route's `band` and `order` filters give.
export function banded(rows: WorkerRow[], band: Band, count: number): WorkerRow[] {
  const sign = band === "low" ? 1 : -1;
  return rows
    .filter((row) => row.trust?.band === band)
    .sort((a, b) => sign * (a.trust!.score - b.trust!.score))
    .slice(0, count);
}
