import { ENCOUNTER_TYPE } from "@/constants/tanuhConcepts";
import { findScreeningReview, isCompleted, isProgramEncounter, isScheduled, pairBookedReviewToScreening } from "./encounters";
import type { EncounterApiResponse, SubjectApiResponse } from "./types";

// tanuh-webapp#5: one page per case. A reviewed screening opens read-only on its review; a screening with a booked
// review lands on that review (drafts are keyed by the route, so two routes to one case would give two drafts); a case
// that cannot take a review opens read-only and says why; any other screening opens the page whose submit creates the
// review.
export type CaseRoute =
  | { kind: "reviewed"; review: EncounterApiResponse }
  | { kind: "booked"; reviewUuid: string }
  | { kind: "unavailable"; reason: string }
  | { kind: "create" };

export function decideCaseRoute(
  screening: EncounterApiResponse,
  subject: SubjectApiResponse,
  reviews: EncounterApiResponse[],
  screenings: EncounterApiResponse[],
): CaseRoute {
  const review = findScreeningReview(screening, reviews);
  if (review) return { kind: "reviewed", review };
  const reason = whyNotReviewable(screening, subject);
  if (reason) return { kind: "unavailable", reason };
  const booked = reviews.find((r) => isScheduled(r) && pairBookedReviewToScreening(r, screenings)?.ID === screening.ID);
  if (booked) return { kind: "booked", reviewUuid: booked.ID };
  // There is no program POST: a program screening is reviewed only through the review its rule booked.
  if (isProgramEncounter(screening))
    return {
      kind: "unavailable",
      reason: "This case is recorded inside a program and can be reviewed only from its booked review.",
    };
  return { kind: "create" };
}

// Each of these would otherwise take the create path and write a review, and on High Risk its follow-ups, against a
// deleted or unfinished record. A deleted patient's row stays in the list until the page is reloaded. Checked before
// the booked review too, so the case page never leads into a deleted patient's review.
function whyNotReviewable(screening: EncounterApiResponse, subject: SubjectApiResponse): string | null {
  if (screening["Encounter type"] !== ENCOUNTER_TYPE.oralScreening.name)
    return "This visit is not an Oral Screening, so there is no case to review.";
  if (subject.Voided) return "This patient was deleted, so the case cannot be reviewed.";
  if (screening.Voided) return "This screening was deleted, so it cannot be reviewed.";
  if (!isCompleted(screening)) return "This screening was not completed, so there is nothing to review.";
  return null;
}
