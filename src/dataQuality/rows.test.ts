import { describe, expect, it } from "vitest";
import type { HistoryPoint, RuleInfo, RuleWorker, RuleWorkersPage, WorkerPeriod } from "./api/types";
import { checkedNoun } from "./format";
import { busiestTaluk, historyOf, periodOf } from "./rows";

const NO_GATES = { quality: null, fabrication_suspicion: null, provenance_confidence: null, sufficiency: null, trust: null };

const scored = (peer_group_key: number | null, n_records: number): WorkerPeriod => ({
  ...NO_GATES,
  period_start: "2026-11-23",
  period_end: "2026-11-29",
  peer_group_key,
  n_records,
  insufficient: false,
  trend: null,
  rules: [],
});

const point = (period_start: string, peer_group_key: number | null, n_records: number): HistoryPoint => ({
  ...NO_GATES,
  period_start,
  period_end: period_start,
  peer_group_key,
  n_records,
  insufficient: false,
  trend: null,
});

const failing = (taluk_id: string | null, n_violations: number): RuleWorker => ({
  ...NO_GATES,
  worker_id: `w-${taluk_id}-${n_violations}`,
  peer_group_key: 1,
  name: null,
  village_name: null,
  taluk_id,
  taluk_name: null,
  status: "failed",
  n_evaluated: 10,
  n_violations,
  rate: null,
  statistic: null,
  sub_score: null,
  insufficient: false,
});

const page = (workers: RuleWorker[]): RuleWorkersPage => ({
  rule_id: "r",
  title: null,
  grain: "week",
  period_start: "2026-11-23",
  period_end: "2026-11-29",
  total: workers.length,
  total_violations: 0,
  page: 1,
  page_size: 1000,
  workers,
});

describe("periodOf", () => {
  const periods = [scored(7, 2), scored(3, 27)];

  it("is the worker's score in the peer group the row was opened from", () => {
    expect(periodOf(periods, "3")?.n_records).toBe(27);
    expect(periodOf(periods, "7")?.n_records).toBe(2);
  });

  it("is nothing for a peer group the worker has no score in", () => {
    expect(periodOf(periods, "9")).toBeNull();
  });

  it("is the score with no peer group, or else the first, when no group is named", () => {
    expect(periodOf(periods, null)?.n_records).toBe(2);
    expect(periodOf([scored(3, 27), scored(null, 5)], null)?.n_records).toBe(5);
  });
});

describe("historyOf", () => {
  it("keeps one point a period, the one in the named peer group where there is one", () => {
    const points = [point("2026-11-16", 7, 4), point("2026-11-23", 7, 2), point("2026-11-23", 3, 27)];
    expect(historyOf(points, "3").map((one) => one.n_records)).toEqual([4, 27]);
    expect(historyOf(points, "7").map((one) => one.n_records)).toEqual([4, 2]);
  });
});

describe("busiestTaluk", () => {
  it("is the taluk with the most failures added up over its workers", () => {
    const workers = [failing("bengaluru-north", 39), failing("maddur", 40), failing("maddur", 22), failing(null, 90)];
    expect(busiestTaluk(page(workers))).toBe("maddur");
  });

  it("counts the workers who lost score when nobody recorded a failure", () => {
    expect(busiestTaluk(page([failing("a", 0), failing("b", 0), failing("b", 0)]))).toBe("b");
  });

  it("is null when no failing worker is filed under a taluk", () => {
    expect(busiestTaluk(page([failing(null, 3)]))).toBeNull();
    expect(busiestTaluk(page([]))).toBeNull();
  });
});

describe("checkedNoun", () => {
  const rule = (record_types: string[]) => ({ record_types }) as RuleInfo;

  it("calls a rule's records photos when it checks only the photo type", () => {
    expect(checkedNoun(rule(["oral_image"]), "oral_image")).toBe("photos");
  });

  it("calls them records for any other rule, or a tenant with no photos", () => {
    expect(checkedNoun(rule(["oral_screening"]), "oral_image")).toBe("records");
    expect(checkedNoun(rule(["oral_screening", "oral_image"]), "oral_image")).toBe("records");
    expect(checkedNoun(rule(["oral_image"]), null)).toBe("records");
    expect(checkedNoun(undefined, "oral_image")).toBe("records");
  });
});
