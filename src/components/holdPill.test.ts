import { format, parseISO } from "date-fns";
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
  it("says you for the viewer and Waiting for review for nobody, with no tooltip", () => {
    expect(holdPill({ kind: "mine", since: new Date(2026, 10, 23, 14, 5).toISOString() }, suffix)).toEqual({
      label: "In review by you",
    });
    expect(holdPill({ kind: "waiting" }, suffix)).toEqual({ label: "Waiting for review" });
  });
  it("says Waiting for OCSHR result for a case that is not handed out until its result arrives", () => {
    expect(holdPill({ kind: "waiting" }, suffix, { waitingFor: "ocshr" })).toEqual({
      label: "Waiting for OCSHR result",
    });
    // A hold is named as before, whatever the case waits for.
    const since = new Date(2026, 10, 23, 14, 5).toISOString();
    expect(holdPill({ kind: "mine", since }, suffix, { waitingFor: "ocshr" }).label).toBe("In review by you");
  });
  it("says No OCSHR result for a case the OCSHR model will never score, and not that it waits", () => {
    expect(holdPill({ kind: "waiting" }, suffix, { waitingFor: "no-ocshr" })).toEqual({ label: "No OCSHR result" });
    const since = new Date(2026, 10, 23, 14, 5).toISOString();
    expect(holdPill({ kind: "mine", since }, suffix, { waitingFor: "no-ocshr" }).label).toBe("In review by you");
    const other = { kind: "other", by: "physician4@tanuh_uat_local", since } as const;
    expect(holdPill(other, suffix, { waitingFor: "no-ocshr" })).toEqual(holdPill(other, suffix));
  });
  it("says Waiting for review when the case waits for review, as without the option", () => {
    expect(holdPill({ kind: "waiting" }, suffix, { waitingFor: "review" })).toEqual({ label: "Waiting for review" });
  });
  describe("withSince, for the case page's header (PE-250)", () => {
    const since = "2026-11-23T05:11:00Z";
    it("adds the time the viewer took the case", () => {
      expect(holdPill({ kind: "mine", since }, suffix, { withSince: true })).toEqual({
        label: `In review by you · since ${format(parseISO(since), "h:mm a")}`,
      });
    });
    it("says In review by you when the time cannot be read", () => {
      expect(holdPill({ kind: "mine", since: "garbage" }, suffix, { withSince: true })).toEqual({
        label: "In review by you",
      });
    });
    it("changes nothing for another physician's hold or a waiting case", () => {
      const other = { kind: "other", by: "physician4@tanuh_uat_local", since } as const;
      expect(holdPill(other, suffix, { withSince: true })).toEqual(holdPill(other, suffix));
      expect(holdPill({ kind: "waiting" }, suffix, { withSince: true })).toEqual({ label: "Waiting for review" });
      expect(holdPill({ kind: "waiting" }, suffix, { withSince: true, waitingFor: "ocshr" })).toEqual({
        label: "Waiting for OCSHR result",
      });
      expect(holdPill({ kind: "waiting" }, suffix, { withSince: true, waitingFor: "no-ocshr" })).toEqual({
        label: "No OCSHR result",
      });
    });
    it("leaves the list's In review by you as it is without the option", () => {
      expect(holdPill({ kind: "mine", since }, suffix)).toEqual({ label: "In review by you" });
      expect(holdPill({ kind: "mine", since }, suffix, { withSince: false })).toEqual({ label: "In review by you" });
    });
  });
});
