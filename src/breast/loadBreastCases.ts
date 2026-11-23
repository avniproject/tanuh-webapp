import { sweepEncounters } from "@/api/encounters";
import { BREAST_VISITS } from "./breastConcepts";
import { buildBreastCases, type BreastCase } from "./breastList";
import { draftMarks, type DraftScope } from "./drafts";

/**
 * The breast worklist, read visit by visit from Avni and joined here. The three reads are the
 * portal's cached org-wide sweeps, so they stop at 3,000 visits of a type (encounters.ts).
 */
export async function loadBreastCases(scope: DraftScope): Promise<BreastCase[]> {
  const [screenings, riskAssessments, clinicianAssessments] = await Promise.all([
    sweepEncounters(BREAST_VISITS.screening.name),
    sweepEncounters(BREAST_VISITS.assessment.name),
    sweepEncounters(BREAST_VISITS.clinician.name),
  ]);
  return buildBreastCases(screenings, riskAssessments, clinicianAssessments, draftMarks(window.localStorage, scope));
}
