import { describe, expect, it } from "vitest";
import { ENCOUNTER_TYPE } from "@/constants/tanuhConcepts";
import type { EncounterApiResponse } from "./types";
import {
  createReviewVisit,
  decideTake,
  holdBody,
  holdStatus,
  isLiveHold,
  readHold,
  reviewUuidFor,
  uuidV5,
} from "./caseHold";

const t0 = new Date("2026-11-23T10:00:00Z");
const minus = (d: Date, min: number) => new Date(d.getTime() - min * 60_000);

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
const bookedWith = (observations: Record<string, unknown>, extra: Partial<EncounterApiResponse> = {}) => ({
  ...booked,
  observations,
  ...extra,
});
const heldBy = (by: string, at: Date) =>
  bookedWith(
    { "In review by": by, "In review since": at.toISOString() },
    { audit: { "Last modified at": at.toISOString() } },
  );
const completedReview = bookedWith({}, { "Encounter date time": "2026-11-23T09:00:00Z" });
const cancelledReview = bookedWith({}, { "Cancel date time": "2026-11-23T09:00:00Z" });
const voidedReview = bookedWith({}, { Voided: true });

describe("holds", () => {
  it("a hold lasts ten minutes from the server's write", () => {
    const h = { by: "dr.a", since: t0.toISOString(), takenAt: t0.toISOString() };
    expect(isLiveHold(h, new Date(t0.getTime() + 9 * 60_000 + 59_000))).toBe(true);
    expect(isLiveHold(h, new Date(t0.getTime() + 10 * 60_000))).toBe(false);
    expect(isLiveHold({ by: "dr.a", since: minus(t0, 30).toISOString(), takenAt: t0.toISOString() }, t0)).toBe(true);
    expect(isLiveHold({ by: "dr.a", since: new Date(t0.getTime() + 60_000).toISOString() }, t0)).toBe(true);
    expect(isLiveHold({ by: "dr.a", since: "garbage" }, t0)).toBe(false);
    expect(isLiveHold(undefined, t0)).toBe(false);
  });

  it("readHold needs both fields and takes takenAt from the audit", () => {
    expect(readHold(bookedWith({ "In review by": "dr.a" }))).toBeUndefined();
    expect(readHold(heldBy("dr.a", t0))).toEqual({
      by: "dr.a",
      since: t0.toISOString(),
      takenAt: t0.toISOString(),
    });
  });

  it("holdStatus is mine only for the viewer's live hold, and waiting once the review is over", () => {
    expect(holdStatus(heldBy("dr.a", t0), "dr.a", t0)).toEqual({ kind: "mine", since: t0.toISOString() });
    expect(holdStatus(heldBy("dr.b", t0), "dr.a", t0)).toEqual({ kind: "other", by: "dr.b" });
    expect(holdStatus(heldBy("dr.b", minus(t0, 11)), "dr.a", t0)).toEqual({ kind: "waiting" });
    expect(holdStatus(heldBy("dr.a", minus(t0, 11)), "dr.a", t0)).toEqual({ kind: "waiting" });
    expect(holdStatus(undefined, "dr.a", t0)).toEqual({ kind: "waiting" });
    for (const r of [completedReview, cancelledReview, voidedReview]) {
      expect(
        holdStatus({ ...r, observations: { "In review by": "dr.b", "In review since": t0.toISOString() } }, "dr.a", t0),
      ).toEqual({ kind: "waiting" });
    }
  });

  it("decideTake refuses a completed, cancelled or deleted review and a live hold by someone else, and takes an expired or own one", () => {
    expect(decideTake(completedReview, "dr.a", t0)).toBe("completed");
    expect(decideTake(cancelledReview, "dr.a", t0)).toBe("gone");
    expect(decideTake(voidedReview, "dr.a", t0)).toBe("gone");
    expect(decideTake(heldBy("dr.b", t0), "dr.a", t0)).toBe("held");
    expect(decideTake(heldBy("dr.b", minus(t0, 11)), "dr.a", t0)).toBe("take");
    expect(decideTake(heldBy("dr.a", t0), "dr.a", t0)).toBe("take");
    expect(decideTake(null, "dr.a", t0)).toBe("take");
  });
});

describe("holdBody", () => {
  it("keeps the window, stays planned, and swaps only the marker", () => {
    const b = holdBody(
      bookedWith({ "Reviewed Oral Screening": "s1", "In review by": "x", "In review since": "y" }),
      { by: "dr.a", since: "t", takenAt: "never written" },
    );
    expect(b["Encounter date time"]).toBeNull();
    expect(b["Encounter type"]).toBe("Clinician Review Form");
    expect(b["Subject ID"]).toBe("sub1");
    expect(b["Earliest scheduled date"]).toBe(booked["Earliest scheduled date"]);
    expect(b["Max scheduled date"]).toBe(booked["Max scheduled date"]);
    expect(b).not.toHaveProperty("External ID");
    expect(b.observations).toEqual({ "Reviewed Oral Screening": "s1", "In review by": "dr.a", "In review since": "t" });
    expect(holdBody(bookedWith({ "In review by": "x", "In review since": "y" }), null).observations).toEqual({});
  });

  it("adds extra observations", () => {
    expect(holdBody(bookedWith({ a: 1 }), null, { b: 2 }).observations).toEqual({ a: 1, b: 2 });
  });
});

describe("review uuid", () => {
  it("uuidV5 matches the RFC vector", async () => {
    expect(await uuidV5("www.example.com", "6ba7b810-9dad-11d1-80b4-00c04fd430c8")).toBe(
      "2ed6657d-e927-568b-95e1-2665a8aea6a2",
    );
  });

  it("reviewUuidFor is stable, differs per screening and from the screening's own uuid", async () => {
    const s1 = "11111111-1111-4111-8111-111111111111";
    const s2 = "22222222-2222-4222-8222-222222222222";
    const a = await reviewUuidFor(s1);
    expect(await reviewUuidFor(s1)).toBe(a);
    expect(a).not.toBe(s1);
    expect(a).not.toBe(await reviewUuidFor(s2));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("createReviewVisit", () => {
  const screening = { ...booked, ID: "scr1", "Subject ID": "sub9" };
  const today = new Date(2026, 10, 23, 15, 30);

  it("names the visit and uses the rule's window", () => {
    const { url, body } = createReviewVisit(screening, "rev-uuid", today);
    expect(url).toBe("/web/encounters");
    expect(body).toMatchObject({
      uuid: "rev-uuid",
      encounterTypeUUID: ENCOUNTER_TYPE.physicianReviewForm.uuid,
      name: "Clinician Review Form",
      individualUUID: "sub9",
      earliestVisitDateTime: new Date(2026, 10, 23, 0, 0, 0, 0).toISOString(),
      maxVisitDateTime: new Date(2026, 10, 25, 23, 59, 59, 999).toISOString(),
    });
  });

  it("goes to /web/programEncounters inside an enrolment", () => {
    const { url, body } = createReviewVisit({ ...screening, "Enrolment ID": "enr1" }, "rev-uuid", today);
    expect(url).toBe("/web/programEncounters");
    expect(body).toMatchObject({ programEnrolmentUUID: "enr1" });
  });
});
