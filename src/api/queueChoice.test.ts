import { describe, expect, it, vi } from "vitest";
import type { CachedEncounter } from "./encounters";
import type { EncounterWithLocation } from "./impl";
import { chooseGroup, heldByViewer, nextCaseIn, reviewedToday, takeNextCase, waitingCounts } from "./queueChoice";
import type { QueueRow } from "./queueRows";
import type { TakeResult } from "./caseHold";
import { classify, signalsOf } from "./caseSignals";
import {
  IN_REVIEW_BY_CONCEPT,
  IN_REVIEW_SINCE_CONCEPT,
  OCSHR_RESULT_CONCEPT,
  REVIEWED_ORAL_SCREENING_CONCEPT,
} from "@/constants/tanuhConcepts";

const NOW = new Date(2026, 9, 7, 10, 30);
const at = (minute: number, day = 7) => new Date(2026, 9, day, 10, minute).toISOString();

const screening = (id: string, minute: number, flw: boolean, edge: "Suspicious" | null = null): CachedEncounter =>
  ({
    ID: id,
    "Subject ID": "p-" + id,
    Voided: false,
    "Encounter date time": at(minute),
    flwPositive: flw,
    edgeVerdict: edge,
    observations: { [OCSHR_RESULT_CONCEPT.name]: "Not High Risk" },
  }) as unknown as CachedEncounter;

const row = (id: string, minute: number, flw: boolean, held?: { by: string; modifiedMinute: number }): QueueRow => {
  const s = screening(id, minute, flw, flw ? null : "Suspicious");
  const cls = classify(signalsOf(s));
  if (!held) return { kind: "screening", screening: s, cls };
  const stored = {
    ID: "r-" + id,
    observations: { [IN_REVIEW_BY_CONCEPT.name]: held.by, [IN_REVIEW_SINCE_CONCEPT.name]: at(held.modifiedMinute) },
    audit: { "Last modified at": at(held.modifiedMinute) },
  } as unknown as CachedEncounter;
  return {
    kind: "booked",
    review: { encounterUuid: "r-" + id } as unknown as EncounterWithLocation,
    stored,
    screening: s,
    cls,
  };
};

describe("chooseGroup", () => {
  const waiting = { "FLW marked": 5, "AI marked": 5, "Safety sample": 1 };
  it("takes the group reviewed least", () => {
    expect(chooseGroup({ "FLW marked": 2, "AI marked": 1, "Safety sample": 0 }, waiting)).toBe("Safety sample");
  });
  it("moves on when that group has nothing waiting", () => {
    expect(chooseGroup({ "FLW marked": 2, "AI marked": 1, "Safety sample": 0 }, { ...waiting, "Safety sample": 0 })).toBe("AI marked");
  });
  it("breaks ties FLW, AI, Safety", () => {
    expect(chooseGroup({ "FLW marked": 0, "AI marked": 0, "Safety sample": 0 }, waiting)).toBe("FLW marked");
  });
  it("is null when nothing waits", () => {
    expect(chooseGroup({ "FLW marked": 0, "AI marked": 0, "Safety sample": 0 }, { "FLW marked": 0, "AI marked": 0, "Safety sample": 0 })).toBeNull();
  });
});

describe("nextCaseIn", () => {
  it("returns the oldest and skips one held live by another physician", () => {
    const rows = [row("a", 5, true), row("b", 1, true, { by: "dr.b", modifiedMinute: 25 }), row("c", 3, true)];
    expect(nextCaseIn(rows, "FLW marked", "dr.a", NOW)?.screening?.ID).toBe("c");
  });
  it("takes a row whose hold is 11 minutes old", () => {
    const rows = [row("a", 5, true), row("b", 1, true, { by: "dr.b", modifiedMinute: 19 })];
    expect(nextCaseIn(rows, "FLW marked", "dr.a", NOW)?.screening?.ID).toBe("b");
  });
  it("is undefined when the group has none", () => {
    expect(nextCaseIn([row("a", 5, true)], "AI marked", "dr.a", NOW)).toBeUndefined();
  });
});

describe("heldByViewer", () => {
  it("finds the viewer's live hold and ignores others", () => {
    const rows = [row("a", 5, true, { by: "dr.b", modifiedMinute: 25 }), row("b", 2, false, { by: "dr.a", modifiedMinute: 25 })];
    expect(heldByViewer(rows, "dr.a", NOW)?.screening?.ID).toBe("b");
    expect(heldByViewer([row("a", 5, true)], "dr.a", NOW)).toBeUndefined();
  });
});

describe("waitingCounts", () => {
  it("leaves out pending and held rows", () => {
    const pending = row("p", 1, true);
    if (pending.cls) pending.cls = { ...pending.cls, ocshrPending: true };
    const rows = [row("a", 1, true), row("b", 2, false), row("c", 3, true, { by: "dr.b", modifiedMinute: 25 }), row("d", 4, true, { by: "dr.a", modifiedMinute: 25 }), pending];
    expect(waitingCounts(rows, "dr.a", NOW)).toEqual({ "FLW marked": 1, "AI marked": 1, "Safety sample": 0, total: 2 });
  });
});

describe("reviewedToday", () => {
  const review = (id: string, by: string, stamp: string | undefined, day = 7, voided = false): CachedEncounter =>
    ({
      ID: id,
      Voided: voided,
      "Encounter date time": at(20, day),
      observations: { [IN_REVIEW_BY_CONCEPT.name]: by, ...(stamp ? { [REVIEWED_ORAL_SCREENING_CONCEPT.name]: stamp } : {}) },
    }) as unknown as CachedEncounter;
  const screenings = [screening("s1", 1, true), screening("s2", 2, false, "Suspicious")];
  it("counts today's own reviews by group, not yesterday's, another physician's or unstamped", () => {
    const reviews = [
      review("r1", "dr.a", "s1"),
      review("r2", "dr.a", "s2"),
      review("r3", "dr.a", "s2"),
      review("r4", "dr.a", "s1", 6),
      review("r5", "dr.b", "s1"),
      review("r6", "dr.a", undefined),
      review("r7", "dr.a", "nope"),
      review("r8", "dr.a", "s1", 7, true),
    ];
    expect(reviewedToday(reviews, screenings, "dr.a", NOW)).toEqual({ "FLW marked": 1, "AI marked": 2, "Safety sample": 0 });
  });
});

// The button's choice (PE-249): the group reviewed least today, its oldest waiting case; a refused case moves to the
// next one in that group, then to the next group.
describe("takeNextCase", () => {
  const none = { "FLW marked": 0, "AI marked": 0, "Safety sample": 0 };
  const key = (r: QueueRow) => r.screening?.ID;

  it("takes the oldest waiting case of the group reviewed least", async () => {
    const rows = [row("f1", 3, true), row("a2", 5, false), row("a1", 2, false)];
    const take = vi.fn(async (r: QueueRow) => ({ reviewUuid: "rev-" + key(r) }));
    await expect(takeNextCase(rows, { ...none, "FLW marked": 1 }, "dr.a", NOW, take)).resolves.toBe("rev-a1");
    expect(take).toHaveBeenCalledTimes(1);
  });

  it("tries the next case in the same group when one is refused", async () => {
    const rows = [row("a1", 2, false), row("a2", 5, false), row("f1", 1, true)];
    const take = vi.fn(async (r: QueueRow) =>
      key(r) === "a1" ? { refused: "held" as const } : { reviewUuid: "rev-" + key(r) },
    );
    await expect(takeNextCase(rows, { ...none, "FLW marked": 1 }, "dr.a", NOW, take)).resolves.toBe("rev-a2");
    expect(take.mock.calls.map(([r]) => key(r))).toEqual(["a1", "a2"]);
  });

  it("chooses again among the other groups once a group's cases are all refused", async () => {
    const rows = [row("a1", 2, false), row("f1", 1, true), row("f2", 4, true)];
    const take = vi.fn(async (r: QueueRow) =>
      key(r) === "a1" || key(r) === "f1" ? { refused: "completed" as const } : { reviewUuid: "rev-" + key(r) },
    );
    await expect(takeNextCase(rows, { ...none, "FLW marked": 1 }, "dr.a", NOW, take)).resolves.toBe("rev-f2");
    expect(take.mock.calls.map(([r]) => key(r))).toEqual(["a1", "f1", "f2"]);
  });

  it("gives up after every waiting case is refused, and never tries one held by someone else", async () => {
    const rows = [row("a1", 2, false), row("f1", 1, true), row("f2", 4, true, { by: "dr.b", modifiedMinute: 25 })];
    const take = vi.fn<(r: QueueRow) => Promise<TakeResult>>(async () => ({ refused: "gone" }));
    await expect(takeNextCase(rows, none, "dr.a", NOW, take)).resolves.toBeNull();
    expect(take.mock.calls.map(([r]) => key(r))).toEqual(["f1", "a1"]);
  });

  it("tries nothing when nothing waits", async () => {
    const take = vi.fn();
    await expect(takeNextCase([], none, "dr.a", NOW, take)).resolves.toBeNull();
    expect(take).not.toHaveBeenCalled();
  });

  it("lets a thrown error through", async () => {
    const take = vi.fn(async () => {
      throw new Error("503");
    });
    await expect(takeNextCase([row("f1", 1, true)], none, "dr.a", NOW, take)).rejects.toThrow("503");
  });
});
