import axios from "axios";
import { ENCOUNTER_ID_CONCEPT, ENCOUNTER_TYPE, readObs } from "@/constants/tanuhConcepts";
import { REVIEW_EXTERNAL_ID_PREFIX, computeNextEncounterId, getEncounter, isCompleted, type UpsertEncounterBody } from "./encounters";
import type { EncounterApiResponse } from "./types";

// tanuh-webapp#5: a screening the model sent for review has no booked review, so its submit creates one. The External
// ID ties the review to its screening and is what the "already reviewed" check reads: a GET by id matches the
// External ID as well as the uuid.
export function reviewExternalId(screeningUuid: string): string {
  return REVIEW_EXTERNAL_ID_PREFIX + screeningUuid;
}

export type CreateDecision = { kind: "refuse" } | { kind: "create"; encounterId: string | null };

// `existing` is what GET /api/encounter/review-<uuid> returned (null on a 404). A live completed review means another
// physician, or a second click, got there first; a voided one is re-created by the POST's upsert and keeps its number.
export function decideCreate(
  existing: EncounterApiResponse | null,
  patientId: string | null | undefined,
  reviews: EncounterApiResponse[],
): CreateDecision {
  if (existing && isCompleted(existing)) return { kind: "refuse" };
  const previous = existing ? readObs<string>(existing.observations ?? {}, ENCOUNTER_ID_CONCEPT) : undefined;
  return { kind: "create", encounterId: previous ?? computeNextEncounterId(patientId, "CLR", reviews, existing?.ID ?? "") };
}

export function buildCreatedReviewBody(
  screening: EncounterApiResponse,
  observations: Record<string, unknown>,
  at: string,
): UpsertEncounterBody {
  return {
    "Encounter type": ENCOUNTER_TYPE.physicianReviewForm.name,
    "Subject ID": screening["Subject ID"],
    "Encounter date time": at,
    "External ID": reviewExternalId(screening.ID),
    observations,
  };
}

// The review created from this screening, by anyone, or null: a GET by id matches the External ID as well as the uuid.
export async function findReviewCreatedFrom(screeningUuid: string): Promise<EncounterApiResponse | null> {
  try {
    return await getEncounter(reviewExternalId(screeningUuid));
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 404) return null;
    throw err;
  }
}
