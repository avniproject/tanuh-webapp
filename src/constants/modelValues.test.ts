import { describe, expect, it } from "vitest";
import {
  ANY_SUSPICIOUS_LESION_CONCEPT,
  MODEL_RESULT_CONCEPT,
  MODEL_RUN_TIME_CONCEPT,
  MODEL_STATUS_CONCEPT,
  MODEL_VERSION_CONCEPT,
  ORAL_IMAGE_GROUP,
  ORAL_SCREENING_GROUP,
  REVIEW_CATEGORY_CONCEPT,
  VISUAL_EXAM_CONCEPTS,
  WORKER_OPINION,
  deriveWorkerOpinion,
  readModelResult,
  readModelRunTime,
  readModelStatus,
  readModelVersion,
  readReviewCategory,
} from "./tanuhConcepts";

const row = (suspicious: unknown) => ({ "Oral Image": "https://s3/p.jpg", [ANY_SUSPICIOUS_LESION_CONCEPT.name]: suspicious });

// The four cases integration-service#131 tests, so the list and the job agree on every screening.
describe("deriveWorkerOpinion", () => {
  it("is Suspicious when one photo of several is marked suspicious", () => {
    expect(deriveWorkerOpinion({ [ORAL_IMAGE_GROUP.name]: [row("No"), row("Yes"), row("No")] })).toBe(WORKER_OPINION.suspicious);
  });
  it("is Not suspicious when no photo is", () => {
    expect(deriveWorkerOpinion({ [ORAL_IMAGE_GROUP.name]: [row("No"), row("No")] })).toBe(WORKER_OPINION.notSuspicious);
  });
  it("reads the ORAL SCREENING group when the take-photos group has no rows", () => {
    expect(deriveWorkerOpinion({ [ORAL_IMAGE_GROUP.name]: [], [ORAL_SCREENING_GROUP.name]: [row("Yes")] })).toBe(WORKER_OPINION.suspicious);
  });
  it("does not count a referral answer of Yes when no photo is marked suspicious", () => {
    const obs = { [ORAL_IMAGE_GROUP.name]: [row("No")], "No referral required as app found no suspicious lesions. Do you still want to refer?": "Yes" };
    expect(deriveWorkerOpinion(obs)).toBe(WORKER_OPINION.notSuspicious);
  });
  it("ignores the ORAL SCREENING group when the take-photos group has rows", () => {
    expect(deriveWorkerOpinion({ [ORAL_IMAGE_GROUP.name]: [row("No")], [ORAL_SCREENING_GROUP.name]: [row("Yes")] })).toBe(WORKER_OPINION.notSuspicious);
  });
  it("accepts a one-item list and a single row object, as the job does", () => {
    expect(deriveWorkerOpinion({ [ORAL_IMAGE_GROUP.name]: row(["Yes"]) })).toBe(WORKER_OPINION.suspicious);
  });
  it("has no opinion without photo rows", () => {
    expect(deriveWorkerOpinion({ [VISUAL_EXAM_CONCEPTS.ableToOpenMouth.name]: "No" })).toBeUndefined();
  });
});

describe("model value readers", () => {
  it("read the five values by name, a coded answer as a string or a one-item list", () => {
    const obs = {
      [MODEL_RESULT_CONCEPT.name]: ["Non Suspicious"],
      [MODEL_STATUS_CONCEPT.name]: "Scored",
      [MODEL_VERSION_CONCEPT.name]: "stub",
      [MODEL_RUN_TIME_CONCEPT.name]: "2026-10-07T10:51:00.474Z",
      [REVIEW_CATEGORY_CONCEPT.name]: "FLW override",
    };
    expect([readModelResult(obs), readModelStatus(obs), readModelVersion(obs), readModelRunTime(obs), readReviewCategory(obs)])
      .toEqual(["Non Suspicious", "Scored", "stub", "2026-10-07T10:51:00.474Z", "FLW override"]);
  });
  it("read nothing from a screening the job has not written", () => {
    expect([readModelResult({}), readModelStatus({}), readModelVersion({}), readModelRunTime({}), readReviewCategory({})])
      .toEqual([undefined, undefined, undefined, undefined, undefined]);
  });
});
