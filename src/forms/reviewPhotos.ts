// Pure review logic, extracted from ReviewForm so it can be imported and tested
// without rendering the component (and so ReviewForm keeps exporting only its
// component, which Fast Refresh requires).
//
// Photo identity is the 1-based position of the photo within the encounter, and
// is deliberately NOT bounded: an encounter carries as many photos as were
// taken — the 14 protocol sites, plus any extra — and every one must reach the
// physician. PHOTO_SLOTS/PHOTO_CONCEPTS survive here only for the two legacy
// flat-layout paths, where the bundle genuinely defines just 8 concepts.
import {
  ORAL_IMAGE_GROUP,
  ORAL_IMAGE_GROUP_CHILD,
  ORAL_SCREENING_GROUP,
  PHOTO_CONCEPTS,
  PHOTO_SLOTS,
  QUALITY_VALUES,
  REVIEW_CONCEPTS,
  REVIEW_IMAGE_GROUP,
  REVIEW_IMAGE_GROUP_CHILD,
  VERDICT_VALUES,
  readObs,
} from "@/constants/tanuhConcepts";
import type { EncounterApiResponse } from "@/api/types";

export type FormState = {
  photoVerdicts: Partial<Record<number, string>>;
  photoQuality: Partial<Record<number, string>>;
  // The single photo flagged as highest-risk (null = none). Only one at a time.
  highestRiskSlot: number | null;
  provisionalDiagnosis: string;
  provisionalSubType: string;
  notes: string;
};

export const emptyForm: FormState = {
  photoVerdicts: {},
  photoQuality: {},
  highestRiskSlot: null,
  provisionalDiagnosis: "",
  provisionalSubType: "",
  notes: "",
};

// A single reviewable photo, normalised across the two Oral Screening capture
// models. `slot` is its 1-based position; the physician verdict is stored
// index-aligned in the review form's repeatable `Images` QuestionGroup.
export interface ReviewPhoto {
  slot: number;
  imageUrl: string;
}

// New encounters store images in a repeatable QuestionGroup (an array of
// `{ "Oral Image" }`). There are two such groups — the "Do you see any lesions?"
// branch decides which one an encounter uses (ORAL_IMAGE_GROUP for the
// lesion-photo flow, ORAL_SCREENING_GROUP for the other) — so read both and map
// their entries to slots 1..N in order. Older encounters used flat
// `Photo N (image)` keys; fall back to that only when neither group has images.
// The AI verdict is no longer surfaced in the physician review
// (Requirements 2.0), so it is not read.
export function collectPhotos(obs: Record<string, unknown>): ReviewPhoto[] {
  const photos: ReviewPhoto[] = [];
  for (const groupName of [ORAL_IMAGE_GROUP.name, ORAL_SCREENING_GROUP.name]) {
    const group = obs[groupName];
    if (!Array.isArray(group)) continue;
    for (const entry of group) {
      if (!entry || typeof entry !== "object") continue;
      const imageUrl = readObs<string>(entry as Record<string, unknown>, ORAL_IMAGE_GROUP_CHILD.image);
      if (!imageUrl) continue;
      photos.push({ slot: photos.length + 1, imageUrl });
    }
  }
  if (photos.length > 0) return photos;
  for (const slot of PHOTO_SLOTS) {
    const imageUrl = readObs<string>(obs, PHOTO_CONCEPTS[slot].image);
    if (!imageUrl) continue;
    photos.push({ slot, imageUrl });
  }
  return photos;
}

// Requirements 2.0: classification is computed from the per-photo physician
// verdicts — Suspicious if any photo is Suspicious, else Non-Suspicious once all
// photos are verdicted. Empty string while still incomplete.
export function deriveClassification(
  presentPhotos: number[],
  photoVerdicts: Partial<Record<number, string>>,
  photoQuality: Partial<Record<number, string>>,
): string {
  // Only acceptable-quality photos are assessable; "No" photos carry no verdict
  // and are excluded from the suspicious/non-suspicious roll-up.
  const assessable = presentPhotos.filter(
    (slot) => (photoQuality[slot] ?? QUALITY_VALUES.yes) !== QUALITY_VALUES.no,
  );
  if (assessable.length === 0) return "";
  if (assessable.some((slot) => photoVerdicts[slot] === VERDICT_VALUES.suspicious)) return VERDICT_VALUES.suspicious;
  if (assessable.every((slot) => Boolean(photoVerdicts[slot]))) return VERDICT_VALUES.nonSuspicious;
  return "";
}

export function prefillFromCompleted(review: EncounterApiResponse): FormState {
  const obs = review.observations as Record<string, unknown>;
  const photoVerdicts: Partial<Record<number, string>> = {};
  const photoQuality: Partial<Record<number, string>> = {};
  let highestRiskSlot: number | null = null;
  // 2.0 reviews store verdicts in the repeatable Images group (index-aligned).
  // Uncapped, to match collectPhotos — a review saved with 16 photos must
  // restore all 16 verdicts when it is reopened, not the first 8.
  const imagesGroup = obs[REVIEW_IMAGE_GROUP.name];
  if (Array.isArray(imagesGroup)) {
    imagesGroup.forEach((row, i) => {
      const slot = i + 1;
      if (!row || typeof row !== "object") return;
      const r = row as Record<string, unknown>;
      const v = r[REVIEW_IMAGE_GROUP_CHILD.physicianVerdict.name];
      if (typeof v === "string") photoVerdicts[slot] = v;
      // Older completed reviews predate this field → treat as acceptable (Yes).
      const q = r[REVIEW_IMAGE_GROUP_CHILD.acceptableQuality.name];
      photoQuality[slot] = typeof q === "string" ? q : QUALITY_VALUES.yes;
      if (r[REVIEW_IMAGE_GROUP_CHILD.highestRiskPhoto.name] === QUALITY_VALUES.yes) highestRiskSlot = slot;
    });
  } else {
    // Pre-2.0 completed reviews: flat per-slot Photo N — Physician verdict.
    PHOTO_SLOTS.forEach((slot) => {
      const v = obs[PHOTO_CONCEPTS[slot].physicianVerdict.name];
      if (typeof v === "string") photoVerdicts[slot] = v;
    });
  }
  return {
    photoVerdicts,
    photoQuality,
    highestRiskSlot,
    provisionalDiagnosis: (obs[REVIEW_CONCEPTS.provisionalDiagnosis.name] as string) ?? "",
    provisionalSubType: (obs[REVIEW_CONCEPTS.provisionalSubType.name] as string) ?? "",
    notes: (readObs<string>(obs, REVIEW_CONCEPTS.notes) as string) ?? "",
  };
}
