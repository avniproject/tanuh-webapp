import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CachedEncounter } from "./encounters";
import type { EncounterWithLocation } from "./impl";
import {
  chooseGroup,
  groupOrderFor,
  heldByViewer,
  nextAndHeld,
  nextCaseIn,
  nextCaseLine,
  reviewedToday,
  takeNextCase,
  waitingCounts,
} from "./queueChoice";
import { queueRowKey, type QueueRow } from "./queueRows";
import type { TakeResult } from "./caseHold";
import { classify, signalsOf } from "./caseSignals";
import {
  IN_REVIEW_BY_CONCEPT,
  IN_REVIEW_SINCE_CONCEPT,
  OCSHR_RESULT_CONCEPT,
  QUEUE_GROUPS,
  REVIEWED_ORAL_SCREENING_CONCEPT,
  type QueueGroup,
} from "@/constants/tanuhConcepts";

const NOW = new Date(2026, 9, 7, 10, 30);

// A physician whose order on `now`'s day starts with `group`, for tests whose expectation rests on the tie order.
const viewerStartingWith = (group: QueueGroup, now: Date): string => {
  for (let i = 0; i < 100; i++) if (groupOrderFor(`physician${i}`, now)[0] === group) return `physician${i}`;
  throw new Error(`No physician starts on ${group}`);
};
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
  const none = { "FLW marked": 0, "AI marked": 0, "Safety sample": 0 };
  it("takes the group reviewed least", () => {
    expect(chooseGroup({ "FLW marked": 2, "AI marked": 1, "Safety sample": 0 }, waiting, QUEUE_GROUPS)).toBe("Safety sample");
  });
  it("moves on when that group has nothing waiting", () => {
    expect(chooseGroup({ "FLW marked": 2, "AI marked": 1, "Safety sample": 0 }, { ...waiting, "Safety sample": 0 }, QUEUE_GROUPS)).toBe("AI marked");
  });
  it("still takes the group reviewed least, whatever the order", () => {
    expect(chooseGroup({ "FLW marked": 0, "AI marked": 1, "Safety sample": 1 }, waiting, ["Safety sample", "AI marked", "FLW marked"])).toBe("FLW marked");
  });
  it("breaks a tie by the physician's order, skipping a group with nothing waiting", () => {
    const order = ["AI marked", "Safety sample", "FLW marked"] as const;
    expect(chooseGroup(none, waiting, order)).toBe("AI marked");
    expect(chooseGroup(none, { ...waiting, "AI marked": 0 }, order)).toBe("Safety sample");
  });
  it("is null when nothing waits", () => {
    expect(chooseGroup(none, none, QUEUE_GROUPS)).toBeNull();
  });
});

// PE-304: the dry run saw every physician start on FLW marked, because ties always went that way. Each physician's
// tie order is now their own, and changes from day to day.
describe("groupOrderFor", () => {
  it("gives every group once, and the same order all day", () => {
    const morning = groupOrderFor("physician1", new Date(2026, 10, 27, 9, 0));
    expect([...morning].sort()).toEqual([...QUEUE_GROUPS].sort());
    expect(groupOrderFor("physician1", new Date(2026, 10, 27, 0, 0))).toEqual(morning);
    expect(groupOrderFor("physician1", new Date(2026, 10, 27, 23, 59))).toEqual(morning);
  });
  it("starts physicians on different groups", () => {
    const day = new Date(2026, 10, 27, 9, 0);
    const firsts = new Set(Array.from({ length: 30 }, (_, i) => groupOrderFor(`physician${i}`, day)[0]));
    expect(firsts.size).toBe(3);
  });
  it("moves a physician's first group from day to day", () => {
    const firsts = new Set(Array.from({ length: 30 }, (_, d) => groupOrderFor("physician1", new Date(2026, 10, 1 + d, 9))[0]));
    expect(firsts.size).toBe(3);
  });
});

// FW13: "an" before a group that starts with a vowel.
describe("nextCaseLine", () => {
  it("names the next group with the right article", () => {
    expect(nextCaseLine("AI marked")).toBe("Next case will be an AI marked case.");
    expect(nextCaseLine("FLW marked")).toBe("Next case will be a FLW marked case.");
    expect(nextCaseLine("Safety sample")).toBe("Next case will be a Safety sample case.");
  });
  it("says when nothing is waiting", () => {
    expect(nextCaseLine(null)).toBe("No cases are waiting for review.");
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
  // Tests whose expected order rests on FLW marked coming first on a tie.
  const flwFirst = viewerStartingWith("FLW marked", NOW);

  it("gives a physician who starts on AI marked an AI case, as the panel says", async () => {
    const viewer = viewerStartingWith("AI marked", NOW);
    const rows = [row("f1", 1, true), row("a1", 2, false)];
    const take = vi.fn(async (r: QueueRow) => ({ reviewUuid: "rev-" + key(r) }));
    expect(nextAndHeld(rows, none, new Set(), viewer, NOW).next).toBe("AI marked");
    await expect(takeNextCase(rows, none, viewer, NOW, take)).resolves.toBe("rev-a1");
  });

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
    await expect(takeNextCase(rows, none, flwFirst, NOW, take)).resolves.toBeNull();
    expect(take.mock.calls.map(([r]) => key(r))).toEqual(["f1", "a1"]);
  });

  it("tries nothing when nothing waits", async () => {
    const take = vi.fn();
    await expect(takeNextCase([], none, "dr.a", NOW, take)).resolves.toBeNull();
    expect(take).not.toHaveBeenCalled();
  });

  // FW1: one case that fails no longer stops every press on the same oldest case.
  describe("a case that fails", () => {
    let logged: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      logged = vi.spyOn(console, "error").mockImplementation(() => {});
    });
    afterEach(() => logged.mockRestore());

    it("is logged and passed over, and the next case is taken", async () => {
      const rows = [row("f1", 1, true), row("f2", 2, true)];
      const take = vi.fn(async (r: QueueRow) => {
        if (key(r) === "f1") throw new Error("503");
        return { reviewUuid: "rev-" + key(r) };
      });
      await expect(takeNextCase(rows, none, "dr.a", NOW, take)).resolves.toBe("rev-f2");
      expect(take.mock.calls.map(([r]) => key(r))).toEqual(["f1", "f2"]);
      expect(logged).toHaveBeenCalledTimes(1);
      expect(logged.mock.calls[0]).toContainEqual(new Error("503"));
    });

    it("moves on to the next group when every case of a group fails", async () => {
      const rows = [row("f1", 1, true), row("a1", 2, false)];
      const take = vi.fn(async (r: QueueRow): Promise<TakeResult> => {
        if (key(r) === "f1") throw new Error("503");
        return { reviewUuid: "rev-" + key(r) };
      });
      await expect(takeNextCase(rows, none, flwFirst, NOW, take)).resolves.toBe("rev-a1");
      expect(take.mock.calls.map(([r]) => key(r))).toEqual(["f1", "a1"]);
    });

    it("raises one error when nothing could be taken and a case failed", async () => {
      const rows = [row("f1", 1, true), row("f2", 2, true), row("a1", 3, false)];
      const take = vi.fn(async (r: QueueRow): Promise<TakeResult> => {
        if (key(r) === "a1") return { refused: "held" };
        throw new Error("503 " + key(r));
      });
      await expect(takeNextCase(rows, none, "dr.a", NOW, take)).rejects.toThrow();
      expect(take).toHaveBeenCalledTimes(3);
      expect(logged).toHaveBeenCalledTimes(2);
    });
  });

  it("records the cases it passed over, refused or failed, and not the one it took", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const held = row("m1", 0, true, { by: flwFirst, modifiedMinute: 25 });
    const rows = [held, row("f1", 1, true), row("f2", 2, true), row("a1", 3, false)];
    const take = vi.fn(async (r: QueueRow): Promise<TakeResult> => {
      if (key(r) === "f1") throw new Error("503");
      if (key(r) === "a1") return { reviewUuid: "rev-a1" };
      return { refused: "reviewed" };
    });
    const passedOver = new Set<string>();
    await expect(takeNextCase(rows, none, flwFirst, NOW, take, held, passedOver)).resolves.toBe("rev-a1");
    expect([...passedOver].sort()).toEqual(["f1", "f2", "r-m1"]);
    logged.mockRestore();
  });

  // FW12: Continue case renews the hold before the page opens, so the physician keeps the case for ten more minutes.
  describe("continuing the case the physician holds", () => {
    const mine = () => row("m1", 0, true, { by: "dr.a", modifiedMinute: 25 });

    it("takes the held case again, and gives it, before any waiting case", async () => {
      const held = mine();
      const take = vi.fn(async (r: QueueRow) => ({ reviewUuid: "rev-" + key(r) }));
      await expect(takeNextCase([held, row("f1", 1, true)], none, "dr.a", NOW, take, held)).resolves.toBe("rev-m1");
      expect(take.mock.calls.map(([r]) => key(r))).toEqual(["m1"]);
    });

    it("moves on to the next waiting case when the held case cannot be taken again", async () => {
      const held = mine();
      const take = vi.fn(async (r: QueueRow): Promise<TakeResult> =>
        key(r) === "m1" ? { refused: "completed" } : { reviewUuid: "rev-" + key(r) },
      );
      await expect(takeNextCase([held, row("f1", 1, true)], none, "dr.a", NOW, take, held)).resolves.toBe("rev-f1");
      expect(take.mock.calls.map(([r]) => key(r))).toEqual(["m1", "f1"]);
    });

    it("moves on, and logs, when renewing the held case fails", async () => {
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      const held = mine();
      const take = vi.fn(async (r: QueueRow): Promise<TakeResult> => {
        if (key(r) === "m1") throw new Error("503");
        return { reviewUuid: "rev-" + key(r) };
      });
      await expect(takeNextCase([held, row("f1", 1, true)], none, "dr.a", NOW, take, held)).resolves.toBe("rev-f1");
      expect(logged).toHaveBeenCalledTimes(1);
      logged.mockRestore();
    });
  });
});

// After a press, the cases it passed over are left out of the next-case line and Continue case until the next press
// reads the queue again: a light refresh still lists them, and a press would only be refused on them again.
describe("nextAndHeld", () => {
  const none = { "FLW marked": 0, "AI marked": 0, "Safety sample": 0 };
  const viewer = viewerStartingWith("FLW marked", NOW);
  const held = row("m1", 0, true, { by: viewer, modifiedMinute: 25 });
  const rows = [held, row("f1", 1, true), row("a1", 2, false)];

  it("is the queue's own next group and held case when no case was passed over", () => {
    const shown = nextAndHeld(rows, none, new Set(), viewer, NOW);
    expect(shown.next).toBe(chooseGroup(none, waitingCounts(rows, viewer, NOW), groupOrderFor(viewer, NOW)));
    expect(shown.next).toBe("FLW marked");
    expect(shown.held && queueRowKey(shown.held)).toBe("r-m1");
  });

  it("leaves out the cases the last press passed over", () => {
    expect(nextAndHeld(rows, none, new Set(["f1", "r-m1"]), viewer, NOW)).toEqual({ next: "AI marked", held: undefined });
    expect(nextAndHeld(rows, none, new Set(["f1", "a1"]), viewer, NOW).next).toBeNull();
  });
});
