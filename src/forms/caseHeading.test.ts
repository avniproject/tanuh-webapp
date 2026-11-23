import { describe, expect, it } from "vitest";
import { caseHeading } from "./caseHeading";

describe("caseHeading", () => {
  it("prefixes Case to a real id when the queue is on", () => {
    expect(caseHeading("P9003ORA001", true)).toBe("Case P9003ORA001");
  });
  it("keeps the neutral label when there is no id and the queue is on", () => {
    expect(caseHeading("", true)).toBe("Patient Review");
    expect(caseHeading(undefined, true)).toBe("Patient Review");
    expect(caseHeading("   ", true)).toBe("Patient Review");
  });
  it("shows the bare id when the queue is off", () => {
    expect(caseHeading("P9003ORA001", false)).toBe("P9003ORA001");
  });
  it("keeps the neutral label when there is no id and the queue is off", () => {
    expect(caseHeading(undefined, false)).toBe("Patient Review");
  });
});
