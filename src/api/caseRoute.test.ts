import { describe, expect, it } from "vitest";
import type { EncounterApiResponse, SubjectApiResponse } from "./types";
import { decideCaseRoute } from "./caseRoute";
import { REVIEWED_ORAL_SCREENING_CONCEPT } from "@/constants/tanuhConcepts";

const t = (s: number) => new Date(Date.UTC(2026, 9, 7, 10, 0, s)).toISOString();
const patient = { ID: "p1", Voided: false } as unknown as SubjectApiResponse;
const screening = { ID: "s1", "Subject ID": "p1", "Encounter type": "Oral Screening", Voided: false, "Encounter date time": t(0), observations: {}, audit: { "Created at": t(0) } } as unknown as EncounterApiResponse;
const booked = { ID: "r1", "Subject ID": "p1", Voided: false, "Encounter date time": null, "Earliest scheduled date": t(1), observations: {}, audit: { "Created at": t(1) } } as unknown as EncounterApiResponse;
const completed = { ID: "r2", "Subject ID": "p1", Voided: false, "Encounter date time": t(50), observations: { [REVIEWED_ORAL_SCREENING_CONCEPT.name]: "s1" } } as unknown as EncounterApiResponse;
const unavailable = (reason: RegExp) => ({ kind: "unavailable", reason: expect.stringMatching(reason) });

describe("decideCaseRoute", () => {
  it("sends a screening with a booked review to that review's page", () => {
    expect(decideCaseRoute(screening, patient, [booked], [screening])).toEqual({ kind: "booked", reviewUuid: "r1" });
  });
  it("opens a reviewed screening read-only on its review", () => {
    expect(decideCaseRoute(screening, patient, [completed], [screening])).toEqual({ kind: "reviewed", review: completed });
  });
  it("creates the review for anything else", () => {
    expect(decideCaseRoute(screening, patient, [], [screening])).toEqual({ kind: "create" });
  });
  it("prefers the recorded review to a booked one", () => {
    expect(decideCaseRoute(screening, patient, [booked, completed], [screening]).kind).toBe("reviewed");
  });
  it("opens read-only a review known only by its External ID", () => {
    const created = { ...completed, ID: "r4", "External ID": "review-s1", observations: {} } as EncounterApiResponse;
    expect(decideCaseRoute(screening, patient, [created], [screening])).toEqual({ kind: "reviewed", review: created });
  });
  it("sends only the referred screening of a two-screening patient to the booked review", () => {
    const later = { ...screening, ID: "s2", "Encounter date time": t(100), audit: { "Created at": t(100) } } as EncounterApiResponse;
    const bookedForLater = { ...booked, ID: "r3", audit: { "Created at": t(101) } } as EncounterApiResponse;
    expect(decideCaseRoute(screening, patient, [bookedForLater], [screening, later])).toEqual({ kind: "create" });
    expect(decideCaseRoute(later, patient, [bookedForLater], [screening, later])).toEqual({ kind: "booked", reviewUuid: "r3" });
  });

  // Review finding: each of these took the create path, and the submit wrote a review against it.
  it("refuses a visit that is not an Oral Screening", () => {
    const other = { ...screening, "Encounter type": "Clinician Review Form" } as EncounterApiResponse;
    expect(decideCaseRoute(other, patient, [], [])).toEqual(unavailable(/not an Oral Screening/));
  });
  it("refuses a deleted screening", () => {
    const deleted = { ...screening, Voided: true } as EncounterApiResponse;
    expect(decideCaseRoute(deleted, patient, [], [deleted])).toEqual(unavailable(/screening was deleted/));
  });
  it("refuses a screening that was planned or cancelled, never done", () => {
    const planned = { ...screening, "Encounter date time": null, "Earliest scheduled date": t(0) } as EncounterApiResponse;
    const cancelled = { ...planned, "Cancel date time": t(5) } as EncounterApiResponse;
    expect(decideCaseRoute(planned, patient, [], [planned])).toEqual(unavailable(/not completed/));
    expect(decideCaseRoute(cancelled, patient, [], [cancelled])).toEqual(unavailable(/not completed/));
  });
  it("refuses a deleted patient's case, even one with a booked review", () => {
    const deletedPatient = { ...patient, Voided: true } as SubjectApiResponse;
    expect(decideCaseRoute(screening, deletedPatient, [], [screening])).toEqual(unavailable(/patient was deleted/));
    expect(decideCaseRoute(screening, deletedPatient, [booked], [screening])).toEqual(unavailable(/patient was deleted/));
  });
  it("refuses a program screening without a booked review, and sends one with a booked review to it", () => {
    const inProgram = { ...screening, "Enrolment ID": "e1" } as EncounterApiResponse;
    const bookedInProgram = { ...booked, "Enrolment ID": "e1" } as EncounterApiResponse;
    expect(decideCaseRoute(inProgram, patient, [], [inProgram])).toEqual(unavailable(/inside a program/));
    expect(decideCaseRoute(inProgram, patient, [bookedInProgram], [inProgram])).toEqual({ kind: "booked", reviewUuid: "r1" });
  });
});
