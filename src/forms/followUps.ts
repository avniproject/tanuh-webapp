import { addDays } from "date-fns";
import { isScheduled, listVisitsFor, scheduleEncounter } from "@/api/encounters";
import type { EncounterApiResponse } from "@/api/types";
import { ENCOUNTER_TYPE } from "@/constants/tanuhConcepts";

// Schedules the High Risk Referral visit unless the subject already has one
// open — re-reviews and double-submits must not pile up duplicate visits.
// Window: due immediately, overdue after 7 days (the scoping doc's follow-up
// convention; the sheet itself doesn't specify dates). A review recorded inside
// a program schedules it in the same enrolment, so it lands under that program
// on the phone.
export async function ensureHighRiskFollowUp(review: EncounterApiResponse): Promise<void> {
  const existing = await listVisitsFor(review, ENCOUNTER_TYPE.highRiskFollowUp.name);
  if (existing.some(isScheduled)) return;
  const now = new Date();
  await scheduleEncounter({
    encounterType: ENCOUNTER_TYPE.highRiskFollowUp,
    subjectId: review["Subject ID"],
    enrolmentId: review["Enrolment ID"],
    earliestVisitDateTime: now.toISOString(),
    maxVisitDateTime: addDays(now, 7).toISOString(),
  });
}

// Schedules the Referral Slip so it lands under Visits Planned on the patient
// dashboard. Same shape and window as the High Risk Referral above; the guard
// keeps re-reviews and double-submits from stacking up slips, and the encounter
// type's eligibility rule suppresses the unplanned entry while one is pending.
export async function ensureReferralSlip(review: EncounterApiResponse): Promise<void> {
  const existing = await listVisitsFor(review, ENCOUNTER_TYPE.referralSlip.name);
  if (existing.some(isScheduled)) return;
  const now = new Date();
  await scheduleEncounter({
    encounterType: ENCOUNTER_TYPE.referralSlip,
    subjectId: review["Subject ID"],
    enrolmentId: review["Enrolment ID"],
    earliestVisitDateTime: now.toISOString(),
    maxVisitDateTime: addDays(now, 7).toISOString(),
  });
}

export interface FollowUpBookings {
  referral: (review: EncounterApiResponse) => Promise<void>;
  slip: (review: EncounterApiResponse) => Promise<void>;
}

// Requirements 2.0 Case Updates: a High Risk diagnosis schedules a "High Risk
// Referral" visit for the screening worker (inform patient, pick biopsy
// hospital), and a "Referral Slip" for them to hand over. The review is already
// saved when this runs. Both are attempted even when the first fails, and the
// answer names each one that failed; null when both are booked. Each skips a
// visit already open, so running it again books only what is missing.
export async function bookHighRiskFollowUps(
  review: EncounterApiResponse,
  book: FollowUpBookings = { referral: ensureHighRiskFollowUp, slip: ensureReferralSlip },
): Promise<string | null> {
  const problems: string[] = [];
  try {
    await book.referral(review);
  } catch (err) {
    problems.push(
      `scheduling the High Risk Referral visit failed: ${messageOf(err)}. ` +
        "Please raise it with the field team so the worker is informed.",
    );
  }
  try {
    await book.slip(review);
  } catch (err) {
    problems.push(
      `scheduling the Referral Slip failed: ${messageOf(err)}. ` +
        "The worker can still raise the slip from the patient's New Form list.",
    );
  }
  return problems.length === 0 ? null : `Review saved, but ${problems.join(" Also, ")}`;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
