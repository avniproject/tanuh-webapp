import { describe, expect, it } from "vitest";
import type { EncounterApiResponse } from "./types";
import { decideCaseRoute } from "./caseRoute";
import { REVIEWED_ORAL_SCREENING_CONCEPT } from "@/constants/tanuhConcepts";

const t = (s: number) => new Date(Date.UTC(2026, 9, 7, 10, 0, s)).toISOString();
const screening = { ID: "s1", "Subject ID": "p1", Voided: false, "Encounter date time": t(0), observations: {}, audit: { "Created at": t(0) } } as unknown as EncounterApiResponse;
const booked = { ID: "r1", "Subject ID": "p1", Voided: false, "Encounter date time": null, "Earliest scheduled date": t(1), observations: {}, audit: { "Created at": t(1) } } as unknown as EncounterApiResponse;
const completed = { ID: "r2", "Subject ID": "p1", Voided: false, "Encounter date time": t(50), observations: { [REVIEWED_ORAL_SCREENING_CONCEPT.name]: "s1" } } as unknown as EncounterApiResponse;

describe("decideCaseRoute", () => {
  it("sends a screening with a booked review to that review's page", () => {
    expect(decideCaseRoute(screening, [booked], [screening])).toEqual({ kind: "booked", reviewUuid: "r1" });
  });
  it("opens a reviewed screening read-only on its review", () => {
    expect(decideCaseRoute(screening, [completed], [screening])).toEqual({ kind: "reviewed", review: completed });
  });
  it("creates the review for anything else", () => {
    expect(decideCaseRoute(screening, [], [screening])).toEqual({ kind: "create" });
  });
  it("prefers the recorded review to a booked one", () => {
    expect(decideCaseRoute(screening, [booked, completed], [screening]).kind).toBe("reviewed");
  });
});
