import { describe, expect, it } from "vitest";
import {
  ORAL_IMAGE_GROUP,
  ORAL_IMAGE_GROUP_CHILD,
  ORAL_SCREENING_GROUP,
  PHOTO_CONCEPTS,
  QUALITY_VALUES,
  REVIEW_IMAGE_GROUP,
  REVIEW_IMAGE_GROUP_CHILD,
  VERDICT_VALUES,
} from "@/constants/tanuhConcepts";
import type { EncounterApiResponse } from "@/api/types";
import { collectPhotos, deriveClassification, prefillFromCompleted } from "./reviewPhotos";

// An Oral Screening's repeatable capture group: one row per photo.
function screeningWithPhotos(count: number, groupName: string = ORAL_IMAGE_GROUP.name) {
  return {
    [groupName]: Array.from({ length: count }, (_, i) => ({
      [ORAL_IMAGE_GROUP_CHILD.image.name]: `https://s3/photo-${i + 1}.jpg`,
    })),
  };
}

// A completed review's repeatable Images group: one row per reviewed photo.
function completedReviewWithVerdicts(count: number): EncounterApiResponse {
  return {
    observations: {
      [REVIEW_IMAGE_GROUP.name]: Array.from({ length: count }, (_, i) => ({
        [REVIEW_IMAGE_GROUP_CHILD.image.name]: `https://s3/photo-${i + 1}.jpg`,
        [REVIEW_IMAGE_GROUP_CHILD.acceptableQuality.name]: QUALITY_VALUES.yes,
        [REVIEW_IMAGE_GROUP_CHILD.physicianVerdict.name]: VERDICT_VALUES.nonSuspicious,
      })),
    },
  } as unknown as EncounterApiResponse;
}

describe("collectPhotos", () => {
  it("collects every photo in an encounter with more than 8", () => {
    const photos = collectPhotos(screeningWithPhotos(16));

    expect(photos).toHaveLength(16);
    expect(photos.map((p) => p.slot)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
  });

  it("collects all 14 photos of a full protocol set", () => {
    expect(collectPhotos(screeningWithPhotos(14))).toHaveLength(14);
  });

  // Testing gotcha: older encounters with fewer than 8 photos must still work.
  it("collects every photo in an encounter with fewer than 8", () => {
    const photos = collectPhotos(screeningWithPhotos(5));

    expect(photos).toHaveLength(5);
    expect(photos.map((p) => p.slot)).toEqual([1, 2, 3, 4, 5]);
  });

  it("reads the second capture group too", () => {
    expect(collectPhotos(screeningWithPhotos(11, ORAL_SCREENING_GROUP.name))).toHaveLength(11);
  });

  // Testing gotcha: the flat legacy layout must keep working. Only 8 flat
  // concepts exist, so this path stays bounded at 8 by the bundle, not by us.
  it("falls back to the flat legacy Photo N keys when no group has images", () => {
    const photos = collectPhotos({
      [PHOTO_CONCEPTS[1].image.name]: "https://s3/legacy-1.jpg",
      [PHOTO_CONCEPTS[2].image.name]: "https://s3/legacy-2.jpg",
    });

    expect(photos).toHaveLength(2);
    expect(photos[0].imageUrl).toBe("https://s3/legacy-1.jpg");
  });

  it("returns nothing when the encounter has no photos", () => {
    expect(collectPhotos({})).toHaveLength(0);
  });
});

describe("deriveClassification", () => {
  const allPhotos = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

  it("finds a suspicious photo beyond the first 8", () => {
    const verdicts: Record<number, string> = {};
    allPhotos(16).forEach((slot) => (verdicts[slot] = VERDICT_VALUES.nonSuspicious));
    verdicts[12] = VERDICT_VALUES.suspicious;

    expect(deriveClassification(allPhotos(16), verdicts, {})).toBe(VERDICT_VALUES.suspicious);
  });

  it("stays incomplete while a photo beyond the first 8 is unverdicted", () => {
    const verdicts: Record<number, string> = {};
    allPhotos(15).forEach((slot) => (verdicts[slot] = VERDICT_VALUES.nonSuspicious));
    // photo 16 deliberately left unverdicted

    expect(deriveClassification(allPhotos(16), verdicts, {})).toBe("");
  });

  it("is non-suspicious once all 16 are verdicted non-suspicious", () => {
    const verdicts: Record<number, string> = {};
    allPhotos(16).forEach((slot) => (verdicts[slot] = VERDICT_VALUES.nonSuspicious));

    expect(deriveClassification(allPhotos(16), verdicts, {})).toBe(VERDICT_VALUES.nonSuspicious);
  });

  it("excludes unacceptable-quality photos from the roll-up", () => {
    const verdicts: Record<number, string> = { 1: VERDICT_VALUES.nonSuspicious };
    const quality: Record<number, string> = { 2: QUALITY_VALUES.no };

    expect(deriveClassification([1, 2], verdicts, quality)).toBe(VERDICT_VALUES.nonSuspicious);
  });
});

describe("prefillFromCompleted", () => {
  it("restores verdicts for every saved photo beyond the first 8", () => {
    const form = prefillFromCompleted(completedReviewWithVerdicts(16));

    expect(Object.keys(form.photoVerdicts)).toHaveLength(16);
    expect(form.photoVerdicts[16]).toBe(VERDICT_VALUES.nonSuspicious);
    expect(form.photoQuality[16]).toBe(QUALITY_VALUES.yes);
  });

  it("restores a review with fewer than 8 photos", () => {
    const form = prefillFromCompleted(completedReviewWithVerdicts(3));

    expect(Object.keys(form.photoVerdicts)).toHaveLength(3);
    expect(form.photoVerdicts[3]).toBe(VERDICT_VALUES.nonSuspicious);
  });

  it("carries the highest-risk flag from a photo beyond the first 8", () => {
    const review = completedReviewWithVerdicts(16);
    const rows = (review.observations as Record<string, unknown>)[REVIEW_IMAGE_GROUP.name] as Record<
      string,
      unknown
    >[];
    rows[13][REVIEW_IMAGE_GROUP_CHILD.highestRiskPhoto.name] = QUALITY_VALUES.yes;

    expect(prefillFromCompleted(review).highestRiskSlot).toBe(14);
  });
});
