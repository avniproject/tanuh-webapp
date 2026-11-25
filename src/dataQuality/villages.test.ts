import { describe, expect, it } from "vitest";
import type { VillageCount, VillageOutline } from "./api/types";
import { countsByOutline, shadeOf, shadeSteps } from "./villages";

const outline = (village_id: string, aliases: string[] = []): VillageOutline => ({
  village_id,
  aliases,
  name: village_id,
  taluk_id: "block:1",
  rings: [],
});

const count = (village_id: string, n_records: number, workers: string[]): VillageCount => ({
  village_id,
  name: null,
  taluk_id: null,
  n_records,
  workers,
});

describe("countsByOutline", () => {
  it("files a count under the outline it names by id or by alias, and keeps the rest apart", () => {
    const filed = countsByOutline(
      [outline("625360", ["avni-17"]), outline("625361")],
      [count("625360", 4, ["w-2"]), count("avni-17", 3, ["w-1", "w-2"]), count("999999", 5, ["w-3"])],
    );
    expect(filed.byOutline.get("625360")).toEqual({ n_records: 7, workers: ["w-1", "w-2"] });
    expect(filed.byOutline.has("625361")).toBe(false);
    expect(filed.unmatched).toBe(5);
  });
});

describe("shadeSteps", () => {
  it("splits the counts into four equal ranges ending at the busiest village", () => {
    expect(shadeSteps(37)).toEqual([10, 20, 30, 37]);
    expect(shadeSteps(40)).toEqual([10, 20, 30, 40]);
  });

  it("has fewer ranges when the busiest village has fewer than four records, and none for none", () => {
    expect(shadeSteps(2)).toEqual([1, 2]);
    expect(shadeSteps(0)).toEqual([]);
  });
});

describe("shadeOf", () => {
  it("is the range a count falls in, or -1 for no records", () => {
    const steps = [10, 20, 30, 37];
    expect([0, 1, 10, 11, 37].map((n) => shadeOf(n, steps))).toEqual([-1, 0, 0, 1, 3]);
  });
});
