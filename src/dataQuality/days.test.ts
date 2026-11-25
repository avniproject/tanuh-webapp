import { describe, expect, it } from "vitest";
import type { DayCount } from "./api/types";
import { latestDay, levelOf, shownCounts } from "./days";

const day = (start: string, future = false): DayCount => ({
  start,
  end: start,
  future,
  records: 30,
  failed: 7,
  unplaced: 4,
  by_type: {
    oral_screening: { records: 10, failed: 3, unplaced: 1 },
    oral_image: { records: 20, failed: 4, unplaced: 3 },
  },
});

describe("shownCounts", () => {
  it("counts one record type alone, and nothing when the day has none of it", () => {
    expect(shownCounts(day("2026-11-24"), { only: "oral_screening", leaveOut: "oral_image" })).toEqual({
      records: 10,
      failed: 3,
      unplaced: 1,
    });
    expect(shownCounts(day("2026-11-24"), { only: "cbac" })).toEqual({ records: 0, failed: 0, unplaced: 0 });
  });

  it("leaves out one record type", () => {
    expect(shownCounts(day("2026-11-24"), { leaveOut: "oral_image" })).toEqual({ records: 10, failed: 3, unplaced: 1 });
  });

  it("keeps everything without a type to keep or leave out, or when the type is absent", () => {
    const all = { records: 30, failed: 7, unplaced: 4 };
    expect(shownCounts(day("2026-11-24"))).toEqual(all);
    expect(shownCounts(day("2026-11-24"), { leaveOut: "cbac" })).toEqual(all);
  });
});

describe("latestDay", () => {
  it("is the last bucket not in the future", () => {
    const days = [day("2026-11-23"), day("2026-11-24"), day("2026-11-25", true)];
    expect(latestDay(days)?.start).toBe("2026-11-24");
  });

  it("is null when every bucket is still to come", () => {
    expect(latestDay([day("2026-11-30", true)])).toBeNull();
  });
});

describe("levelOf", () => {
  it("is 0 only for no records, and the top step for the busiest", () => {
    expect(levelOf(0, 14)).toBe(0);
    expect(levelOf(1, 14)).toBe(1);
    expect(levelOf(14, 14)).toBe(4);
    expect(levelOf(3, 0)).toBe(0);
  });
});
