import { describe, expect, it } from "vitest";
import { holdPill } from "./holdPill";

const suffix = "tanuh_uat_local";

describe("holdPill", () => {
  it("names another physician by the short name, with the full username and the time they took it in the tooltip", () => {
    const since = new Date(2026, 10, 23, 14, 5).toISOString();
    expect(holdPill({ kind: "other", by: "physician4@tanuh_uat_local", since }, suffix)).toEqual({
      label: "In review by physician4",
      tooltip: "physician4@tanuh_uat_local since 14:05",
    });
  });
  it("leaves the time out of the tooltip when it is not known", () => {
    expect(holdPill({ kind: "other", by: "physician4@tanuh_uat_local" }, suffix)).toEqual({
      label: "In review by physician4",
      tooltip: "physician4@tanuh_uat_local",
    });
    expect(holdPill({ kind: "other", by: "physician4@tanuh_uat_local", since: "garbage" }, suffix).tooltip).toBe(
      "physician4@tanuh_uat_local",
    );
  });
  it("shows the full username when the organisation's suffix is not known", () => {
    expect(holdPill({ kind: "other", by: "physician4@tanuh_uat_local" }, undefined).label).toBe(
      "In review by physician4@tanuh_uat_local",
    );
  });
  it("says you for the viewer and Waiting for nobody, with no tooltip", () => {
    expect(holdPill({ kind: "mine", since: new Date(2026, 10, 23, 14, 5).toISOString() }, suffix)).toEqual({
      label: "In review by you",
    });
    expect(holdPill({ kind: "waiting" }, suffix)).toEqual({ label: "Waiting" });
  });
});
