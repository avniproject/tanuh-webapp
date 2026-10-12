import { describe, expect, it } from "vitest";
import type { EncounterApiResponse } from "./types";
import { isScreeningReviewed, pairBookedReviewToScreening, screeningsByReview } from "./encounters";
import { REVIEWED_ORAL_SCREENING_CONCEPT } from "@/constants/tanuhConcepts";

const t = (second: number) => new Date(Date.UTC(2026, 9, 7, 10, 0, second)).toISOString();
const screening = (id: string, createdSecond: number, extra: Partial<EncounterApiResponse> = {}) =>
  ({ ID: id, "Subject ID": "p1", Voided: false, "Encounter date time": t(createdSecond), observations: {}, audit: { "Created at": t(createdSecond) }, ...extra }) as EncounterApiResponse;
const booked = (id: string, createdSecond: number) =>
  ({ ID: id, "Subject ID": "p1", Voided: false, "Encounter date time": null, "Earliest scheduled date": t(createdSecond), observations: {}, audit: { "Created at": t(createdSecond) } }) as unknown as EncounterApiResponse;

describe("pairBookedReviewToScreening", () => {
  // Production books a review only for a referral, so the oldest unclaimed screening is the wrong one.
  it("pairs a booked review with the referred screening that booked it, not an earlier unreferred one", () => {
    const s1 = screening("s1", 0);
    const s2 = screening("s2", 20);
    expect(pairBookedReviewToScreening(booked("r1", 22), [s1, s2])?.ID).toBe("s2");
  });
  it("is not moved by a later screening", () => {
    const s3 = screening("s3", 90);
    expect(pairBookedReviewToScreening(booked("r1", 22), [screening("s1", 0), screening("s2", 20), s3])?.ID).toBe("s2");
  });
  it("skips voided, incomplete and other patients' screenings", () => {
    const others = [
      screening("voided", 21, { Voided: true }),
      screening("draft", 21, { "Encounter date time": null }),
      screening("other", 21, { "Subject ID": "p2" }),
    ];
    expect(pairBookedReviewToScreening(booked("r1", 22), [screening("s2", 20), ...others])?.ID).toBe("s2");
  });
});

describe("isScreeningReviewed", () => {
  const completedReview = (extra: Partial<EncounterApiResponse>) =>
    ({ ID: "r", "Subject ID": "p1", Voided: false, "Encounter date time": t(30), observations: {}, ...extra }) as EncounterApiResponse;
  it("is true for a completed review stamped with the screening", () => {
    expect(isScreeningReviewed(screening("s1", 0), [completedReview({ observations: { [REVIEWED_ORAL_SCREENING_CONCEPT.name]: "s1" } })])).toBe(true);
  });
  it("is true for a review created from the screening's page", () => {
    expect(isScreeningReviewed(screening("s1", 0), [completedReview({ "External ID": "review-s1" })])).toBe(true);
  });
  it("is false for a voided or booked review", () => {
    const stamp = { [REVIEWED_ORAL_SCREENING_CONCEPT.name]: "s1" };
    expect(isScreeningReviewed(screening("s1", 0), [
      completedReview({ observations: stamp, Voided: true }),
      completedReview({ observations: stamp, "Encounter date time": null }),
    ])).toBe(false);
  });
});

describe("screeningsByReview", () => {
  const completed = (id: string, createdSecond: number, stamp?: string) =>
    ({
      ID: id, "Subject ID": "p1", Voided: false, "Encounter date time": t(createdSecond + 100),
      observations: stamp ? { [REVIEWED_ORAL_SCREENING_CONCEPT.name]: stamp } : {}, audit: { "Created at": t(createdSecond) },
    }) as EncounterApiResponse;

  // Review finding (#5): the review page paired a booked review with the oldest unclaimed screening. A patient's
  // unreferred S1 took the review S2's referral booked: the page showed S1's photos and the submit stamped S1.
  it("gives a booked review the screening that booked it, as the list and the case page do", () => {
    const s1 = screening("s1", 0);
    const s2 = screening("s2", 20);
    const r1 = booked("r1", 22);
    expect(screeningsByReview([r1], [s1, s2]).get("r1")?.ID).toBe("s2");
    expect(screeningsByReview([r1], [s1, s2]).get("r1")).toBe(pairBookedReviewToScreening(r1, [s1, s2]));
  });
  it("keeps a completed review on its stamp, and an unstamped one on the created-order pairing", () => {
    const paired = screeningsByReview([completed("legacy", 5), completed("stamped", 22, "s2")], [screening("s1", 0), screening("s2", 20)]);
    expect(paired.get("stamped")?.ID).toBe("s2");
    expect(paired.get("legacy")?.ID).toBe("s1");
  });
  it("leaves the created-order pairing for a booked review the booking rule cannot place", () => {
    const noCreatedAt = { ...booked("r1", 22), audit: {} } as EncounterApiResponse;
    expect(screeningsByReview([noCreatedAt], [screening("s1", 0)]).get("r1")?.ID).toBe("s1");
  });
});
