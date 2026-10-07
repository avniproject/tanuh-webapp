import { describe, expect, it } from "vitest";
import { inSubtree } from "./address";

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
