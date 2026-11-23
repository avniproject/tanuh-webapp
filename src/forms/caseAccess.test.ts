import { describe, expect, it } from "vitest";
import type { EncounterApiResponse } from "@/api/types";
import { caseNoticeText, decideCaseAccess, decideSubmit, formToShow, noticeWaitingFor } from "./caseAccess";

const t0 = new Date("2026-11-23T10:00:00Z");
const later = (min: number) => new Date(t0.getTime() + min * 60_000);

const booked: EncounterApiResponse = {
  ID: "r1",
  "Subject ID": "sub1",
  "Subject external ID": null,
  "Subject type": "Individual",
  Voided: false,
  "External ID": null,
  "Encounter type": "Clinician Review Form",
  "Encounter date time": null,
  "Earliest scheduled date": "2026-11-20T00:00:00.000Z",
  "Max scheduled date": "2026-11-22T23:59:59.999Z",
  "Cancel date time": null,
  observations: {},
};
const heldBy = (by: string, at: Date, extra: Partial<EncounterApiResponse> = {}): EncounterApiResponse => ({
  ...booked,
  observations: { "In review by": by, "In review since": at.toISOString() },
  audit: { "Last modified at": at.toISOString() },
  ...extra,
});
const completedBy = (by: string, since: Date): EncounterApiResponse =>
  heldBy(by, since, { "Encounter date time": later(5).toISOString() });

describe("decideCaseAccess", () => {
  it("leaves the page as today when the organisation has no review queue", () => {
    expect(decideCaseAccess(false, { review: booked }, "dr.a", t0)).toEqual({ locked: false, notice: null });
    expect(decideCaseAccess(false, {}, "dr.a", t0)).toEqual({ locked: false, notice: null });
    expect(decideCaseAccess(false, { review: heldBy("dr.b", t0) }, "dr.a", t0)).toEqual({ locked: false, notice: null });
  });

  it("opens a booked review for editing only to the physician holding it", () => {
    expect(decideCaseAccess(true, { review: heldBy("dr.a", t0) }, "dr.a", later(1))).toEqual({
      locked: false,
      notice: { kind: "mine", since: t0.toISOString() },
    });
  });

  it("locks a review another physician holds and names them", () => {
    expect(decideCaseAccess(true, { review: heldBy("dr.b", t0) }, "dr.a", later(1))).toEqual({
      locked: true,
      notice: { kind: "other", by: "dr.b" },
    });
  });

  it("locks a review nobody holds, or whose hold has run out, as waiting", () => {
    expect(decideCaseAccess(true, { review: booked }, "dr.a", t0)).toEqual({ locked: true, notice: { kind: "waiting" } });
    expect(decideCaseAccess(true, { review: heldBy("dr.a", t0) }, "dr.a", later(10))).toEqual({
      locked: true,
      notice: { kind: "waiting" },
    });
  });

  it("locks a screening's page that has no review yet, as waiting", () => {
    expect(decideCaseAccess(true, {}, "dr.a", t0)).toEqual({ locked: true, notice: { kind: "waiting" } });
  });

  it("says nothing about holds on a completed or unavailable case, which stay read-only as today", () => {
    expect(decideCaseAccess(true, { review: completedBy("dr.a", t0) }, "dr.a", later(1))).toEqual({
      locked: true,
      notice: null,
    });
    expect(decideCaseAccess(true, { unavailable: "This patient was deleted, so the case cannot be reviewed." }, "dr.a", t0)).toEqual({
      locked: true,
      notice: null,
    });
  });

  it("never opens a case to a viewer with no name", () => {
    expect(decideCaseAccess(true, { review: heldBy("dr.a", t0) }, "", later(1)).locked).toBe(true);
  });
});

// Fix round 1: a page locked by the hold showed the viewer's own unsent draft, read as the holder's work.
describe("formToShow", () => {
  const forms = { stored: null, draft: "draft", empty: "empty" };

  it("shows the empty form, not the viewer's draft, on a page the hold locks", () => {
    const other = decideCaseAccess(true, { review: heldBy("dr.b", t0) }, "dr.a", later(1));
    const waiting = decideCaseAccess(true, { review: booked }, "dr.a", t0);
    const lapsed = decideCaseAccess(true, { review: heldBy("dr.a", t0) }, "dr.a", later(10));
    const noReview = decideCaseAccess(true, {}, "dr.a", t0);
    for (const access of [other, waiting, lapsed, noReview]) expect(formToShow(access, forms)).toBe("empty");
  });

  it("shows the holder their draft, or the empty form when they have none", () => {
    const mine = decideCaseAccess(true, { review: heldBy("dr.a", t0) }, "dr.a", later(1));
    expect(formToShow(mine, forms)).toBe("draft");
    expect(formToShow(mine, { ...forms, draft: null })).toBe("empty");
  });

  it("shows a completed review's recorded answers", () => {
    const completed = decideCaseAccess(true, { review: completedBy("dr.b", t0) }, "dr.a", later(6));
    expect(formToShow(completed, { ...forms, stored: "stored" })).toBe("stored");
  });

  it("is as today when the organisation has no review queue", () => {
    const off = decideCaseAccess(false, { review: heldBy("dr.b", t0) }, "dr.a", later(1));
    expect(formToShow(off, forms)).toBe("draft");
    expect(formToShow(off, { ...forms, draft: null })).toBe("empty");
    expect(formToShow(off, { ...forms, stored: "stored" })).toBe("stored");
  });

  it("keeps today's draft on an unavailable case, which the hold does not lock", () => {
    const unavailable = decideCaseAccess(true, { unavailable: "This screening was deleted, so it cannot be reviewed." }, "dr.a", t0);
    expect(formToShow(unavailable, forms)).toBe("draft");
  });
});

// FW8: a waiting case the button never gives says so, instead of sending the physician to the button.
describe("a waiting case that Review next case does not give out", () => {
  const screeningWith = (observations: Record<string, unknown>) => ({ ...booked, ID: "s1", "Encounter type": "Oral Screening", observations });
  const ready = screeningWith({ "OCSHR Model Result": "High Risk" });
  const pending = screeningWith({ "Egde AI Final Verdict": "Suspicious" });
  const noGroup = screeningWith({ "OCSHR Model Result": "Not High Risk", "Egde AI Final Verdict": "Non-Suspicious" });

  it("says the OCSHR result is pending when it is", () => {
    const access = decideCaseAccess(true, { review: booked, screening: pending }, "dr.a", t0);
    expect(access).toEqual({ locked: true, notice: { kind: "waiting", reason: "ocshr-pending" } });
    expect(caseNoticeText(access.notice!)).toBe("Not handed out yet: this case's OCSHR result is pending.");
  });

  it("says the case is in no review group when it is not", () => {
    const access = decideCaseAccess(true, { review: booked, screening: noGroup }, "dr.a", t0);
    expect(access).toEqual({ locked: true, notice: { kind: "waiting", reason: "no-group" } });
    expect(caseNoticeText(access.notice!)).toBe(
      "This case is not in a review group, so Review next case does not hand it out.",
    );
  });

  it("keeps the Waiting text for a case the button can give, and for a screening's page with no review", () => {
    const access = decideCaseAccess(true, { review: booked, screening: ready }, "dr.a", t0);
    expect(access).toEqual({ locked: true, notice: { kind: "waiting" } });
    expect(caseNoticeText(access.notice!)).toBe("Waiting. Use Review next case on Pending Reviews to review it.");
    expect(decideCaseAccess(true, { screening: pending }, "dr.a", t0).notice).toEqual({
      kind: "waiting",
      reason: "ocshr-pending",
    });
  });

  // Adam, 23 Nov: a case the OCSHR model will never score does not read as waiting for its result.
  const neverScored = {
    "QC fail": { "Egde AI Final Verdict": "Suspicious", "QC status": "QC Fail" },
    "Call Made No": { "Egde AI Final Verdict": "Suspicious", "OCSHR Call Made": "No" },
    REJECTED: { "Egde AI Final Verdict": "Suspicious", "OCSHR Model Status": "REJECTED" },
    FAILED: { "Egde AI Final Verdict": "Suspicious", "OCSHR Model Status": "FAILED", "OCSHR Model Error": "Bad image" },
  };
  for (const [name, observations] of Object.entries(neverScored)) {
    it(`says the OCSHR model will not score a case with no result: ${name}`, () => {
      const access = decideCaseAccess(true, { review: booked, screening: screeningWith(observations) }, "dr.a", t0);
      expect(access).toEqual({ locked: true, notice: { kind: "waiting", reason: "ocshr-never" } });
      expect(caseNoticeText(access.notice!)).toBe("Not handed out: the OCSHR model will not score this case.");
    });
  }

  it("says the same on a never-scored screening's page with no review yet", () => {
    expect(decideCaseAccess(true, { screening: screeningWith(neverScored["Call Made No"]) }, "dr.a", t0).notice).toEqual({
      kind: "waiting",
      reason: "ocshr-never",
    });
  });

  it("keeps the pending text for a case sent to the model and not yet scored", () => {
    const sent = screeningWith({ "Egde AI Final Verdict": "Suspicious", "OCSHR Call Made": "Yes" });
    const access = decideCaseAccess(true, { review: booked, screening: sent }, "dr.a", t0);
    expect(access.notice).toEqual({ kind: "waiting", reason: "ocshr-pending" });
    expect(caseNoticeText(access.notice!)).toBe("Not handed out yet: this case's OCSHR result is pending.");
  });

  it("treats a failed score that kept an old result as scored, as PE-249 does", () => {
    const stale = screeningWith({ "Egde AI Final Verdict": "Suspicious", "OCSHR Model Status": "FAILED", "OCSHR Model Result": "High Risk" });
    expect(decideCaseAccess(true, { review: booked, screening: stale }, "dr.a", t0).notice).toEqual({ kind: "waiting" });
  });

  it("leaves a held case's notice alone, and the page as today with the queue off", () => {
    expect(decideCaseAccess(true, { review: heldBy("dr.b", t0), screening: pending }, "dr.a", later(1)).notice).toEqual({
      kind: "other",
      by: "dr.b",
    });
    expect(decideCaseAccess(false, { review: booked, screening: pending }, "dr.a", t0)).toEqual({ locked: false, notice: null });
  });
});

describe("noticeWaitingFor, the header pill's waiting words", () => {
  it("waits for the OCSHR result while it is pending", () =>
    expect(noticeWaitingFor({ kind: "waiting", reason: "ocshr-pending" })).toBe("ocshr"));
  it("has no OCSHR result when the model will never score the case", () =>
    expect(noticeWaitingFor({ kind: "waiting", reason: "ocshr-never" })).toBe("no-ocshr"));
  it("waits for review otherwise", () => {
    expect(noticeWaitingFor({ kind: "waiting" })).toBe("review");
    expect(noticeWaitingFor({ kind: "waiting", reason: "no-group" })).toBe("review");
    expect(noticeWaitingFor({ kind: "mine", since: t0.toISOString() })).toBe("review");
    expect(noticeWaitingFor({ kind: "other", by: "dr.b" })).toBe("review");
  });
});

describe("caseNoticeText", () => {
  it("gives the holder the time they took the case, in local time", () => {
    const since = new Date(2026, 10, 23, 9, 5).toISOString();
    expect(caseNoticeText({ kind: "mine", since })).toBe("In review by you since 09:05");
  });

  it("drops the time when the stored one cannot be read", () => {
    expect(caseNoticeText({ kind: "mine", since: "garbage" })).toBe("In review by you");
  });

  it("names another holder, and sends a waiting case to the button", () => {
    expect(caseNoticeText({ kind: "other", by: "dr.b" })).toBe("In review by dr.b");
    expect(caseNoticeText({ kind: "waiting" })).toBe("Waiting. Use Review next case on Pending Reviews to review it.");
  });
});

describe("decideSubmit", () => {
  it("sends neither field, and refuses a review completed meanwhile, when the organisation has no review queue", () => {
    expect(decideSubmit(false, booked, "dr.a", t0)).toEqual({ kind: "send", markers: {} });
    expect(decideSubmit(false, completedBy("dr.b", t0), "dr.a", later(6))).toEqual({ kind: "refuse" });
  });

  it("keeps who reviewed and since when they held it", () => {
    expect(decideSubmit(true, heldBy("dr.a", t0), "dr.a", later(4))).toEqual({
      kind: "send",
      markers: { "In review by": "dr.a", "In review since": t0.toISOString() },
    });
  });

  it("keeps the stored time even after the hold has run out", () => {
    expect(decideSubmit(true, heldBy("dr.a", t0), "dr.a", later(25))).toEqual({
      kind: "send",
      markers: { "In review by": "dr.a", "In review since": t0.toISOString() },
    });
  });

  it("stamps now when the review carries no hold", () => {
    expect(decideSubmit(true, booked, "dr.a", later(3))).toEqual({
      kind: "send",
      markers: { "In review by": "dr.a", "In review since": later(3).toISOString() },
    });
  });

  it("stamps now rather than another physician's time when the stored hold is theirs", () => {
    expect(decideSubmit(true, heldBy("dr.b", t0), "dr.a", later(12))).toEqual({
      kind: "send",
      markers: { "In review by": "dr.a", "In review since": later(12).toISOString() },
    });
  });

  // D9: the later submission is kept.
  it("completes again a review someone else completed meanwhile, under this physician", () => {
    expect(decideSubmit(true, completedBy("dr.b", t0), "dr.a", later(6))).toEqual({
      kind: "send",
      markers: { "In review by": "dr.a", "In review since": later(6).toISOString() },
    });
  });
});
