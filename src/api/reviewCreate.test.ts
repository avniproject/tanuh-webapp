import { describe, expect, it } from "vitest";
import type { EncounterApiResponse } from "./types";
import { buildCreatedReviewBody, decideCreate, reviewExternalId } from "./reviewCreate";
import { ENCOUNTER_ID_CONCEPT, ENCOUNTER_TYPE } from "@/constants/tanuhConcepts";

const screening = { ID: "s-uuid", "Subject ID": "p-uuid", observations: {} } as unknown as EncounterApiResponse;
const review = (extra: Partial<EncounterApiResponse>) =>
  ({ ID: "r-uuid", "Subject ID": "p-uuid", Voided: false, "Encounter date time": "2026-10-07T10:00:00.000Z", observations: {}, ...extra }) as EncounterApiResponse;

describe("the created review", () => {
  it("carries External ID review-<screening uuid>, never the bare uuid", () => {
    const body = buildCreatedReviewBody(screening, { x: 1 }, "2026-10-07T10:00:00.000Z");
    expect(body["External ID"]).toBe("review-s-uuid");
    expect(body["External ID"]).not.toBe(screening.ID);
    expect(body).toMatchObject({ "Encounter type": ENCOUNTER_TYPE.physicianReviewForm.name, "Subject ID": "p-uuid", "Encounter date time": "2026-10-07T10:00:00.000Z", observations: { x: 1 } });
    expect(reviewExternalId("s-uuid")).toBe("review-s-uuid");
  });
});

describe("decideCreate", () => {
  it("refuses when the case already has a live completed review", () => {
    expect(decideCreate(review({}), "P01", [])).toEqual({ kind: "refuse" });
  });
  it("numbers a first review from the patient's other reviews", () => {
    expect(decideCreate(null, "P01", [])).toEqual({ kind: "create", encounterId: "P01CLR001" });
  });
  it("reuses the Encounter ID of a voided earlier attempt", () => {
    const voided = review({ Voided: true, observations: { [ENCOUNTER_ID_CONCEPT.name]: "P01CLR004" } });
    expect(decideCreate(voided, "P01", [])).toEqual({ kind: "create", encounterId: "P01CLR004" });
  });
  it("writes no Encounter ID for a patient without a Patient ID, as the phone does", () => {
    expect(decideCreate(null, undefined, [])).toEqual({ kind: "create", encounterId: null });
  });
});
