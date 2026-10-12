import { describe, expect, it } from "vitest";
import { inSubtree, patientsInLocation } from "./address";

describe("inSubtree", () => {
  const chain = { State: "Karnataka", District: "Bengaluru Rural" };
  it("matches an address carrying every level of the chain", () => {
    expect(inSubtree({ State: "Karnataka", District: "Bengaluru Rural", Village: "Begur" }, chain)).toBe(true);
  });
  it("does not match another district or a missing address", () => {
    expect(inSubtree({ State: "Karnataka", District: "Mysuru" }, chain)).toBe(false);
    expect(inSubtree(undefined, chain)).toBe(false);
  });
});

// Review finding (#4): a patient whose read failed was placed nowhere, so the location filter dropped their cases silently.
describe("patientsInLocation", () => {
  const chain = { State: "Karnataka", District: "Bengaluru Rural" };
  it("keeps the patients in the location, drops the others, and keeps and reports those it cannot place", () => {
    const subjects = new Map<string, { location?: unknown } | null>([
      ["here", { location: { ...chain, Village: "Begur" } }],
      ["away", { location: { State: "Karnataka", District: "Mysuru" } }],
      ["failed", null],
    ]);
    const { kept, unplaced } = patientsInLocation(["here", "away", "failed", "never-read"], subjects, chain);
    expect([...kept]).toEqual(["here", "failed", "never-read"]);
    expect([...unplaced]).toEqual(["failed", "never-read"]);
  });
});
