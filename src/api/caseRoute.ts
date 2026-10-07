import { REVIEWED_ORAL_SCREENING_CONCEPT, readObs } from "@/constants/tanuhConcepts";
import { REVIEW_EXTERNAL_ID_PREFIX, isCompleted, isScheduled, isScreeningReviewed, pairBookedReviewToScreening } from "./encounters";
import type { EncounterApiResponse } from "./types";

// tanuh-webapp#5: one page per case. A screening with a booked review lands on that review (drafts are keyed by the
// route, so two routes to one case would give two drafts); a reviewed screening opens read-only on its review; any
// other screening opens the page whose submit creates the review.
export type CaseRoute =
  | { kind: "booked"; reviewUuid: string }
  | { kind: "reviewed"; review: EncounterApiResponse }
  | { kind: "create" };

export function decideCaseRoute(
  screening: EncounterApiResponse,
  reviews: EncounterApiResponse[],
  screenings: EncounterApiResponse[],
): CaseRoute {
  if (isScreeningReviewed(screening, reviews)) {
    const review = reviews.find(
      (r) =>
        isCompleted(r) &&
        (readObs<string>(r.observations ?? {}, REVIEWED_ORAL_SCREENING_CONCEPT) === screening.ID ||
          r["External ID"] === REVIEW_EXTERNAL_ID_PREFIX + screening.ID),
    )!;
    return { kind: "reviewed", review };
  }
  const booked = reviews.find((r) => isScheduled(r) && pairBookedReviewToScreening(r, screenings)?.ID === screening.ID);
  return booked ? { kind: "booked", reviewUuid: booked.ID } : { kind: "create" };
}
