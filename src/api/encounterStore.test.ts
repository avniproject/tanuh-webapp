import { describe, expect, it } from "vitest";
import type { EncounterApiResponse } from "./types";
import { trimForCache } from "./encounters";
import {
  ANY_SUSPICIOUS_LESION_CONCEPT, MODEL_RESULT_CONCEPT, MODEL_RUN_TIME_CONCEPT, MODEL_STATUS_CONCEPT,
  MODEL_VERSION_CONCEPT, ORAL_IMAGE_GROUP, PLACE_OF_REFERRAL_CONCEPT, REVIEW_CATEGORY_CONCEPT, WORKER_OPINION,
} from "@/constants/tanuhConcepts";

describe("trimForCache", () => {
  it("keeps the model's values, the referral place and the worker's opinion, and drops the photos", () => {
    const model = {
      [MODEL_RESULT_CONCEPT.name]: "Non Suspicious",
      [MODEL_STATUS_CONCEPT.name]: "Scored",
      [MODEL_VERSION_CONCEPT.name]: "stub",
      [MODEL_RUN_TIME_CONCEPT.name]: "2026-10-07T10:51:00.474Z",
      [REVIEW_CATEGORY_CONCEPT.name]: "FLW override",
      [PLACE_OF_REFERRAL_CONCEPT.name]: { District: "Bengaluru Rural", "Taluka Hospital": "Dental hospital" },
    };
    const screening = {
      ID: "s1", "Subject ID": "p1", "Encounter type": "Oral Screening", Voided: false, "Encounter date time": "2026-10-06T10:00:00.000Z",
      observations: { ...model, [ORAL_IMAGE_GROUP.name]: [{ "Oral Image": "https://s3/1.jpg", [ANY_SUSPICIOUS_LESION_CONCEPT.name]: "Yes" }] },
      audit: { "Created at": "2026-10-06T10:00:05.000Z", "Last modified at": "2026-10-06T10:01:00.000Z", "Created by": "worker" },
    } as unknown as EncounterApiResponse;

    const trimmed = trimForCache(screening);

    expect(trimmed.observations).toEqual(model);
    expect(trimmed.workerOpinion).toBe(WORKER_OPINION.suspicious);
  });
});
