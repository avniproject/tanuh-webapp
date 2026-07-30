// UUIDs + names mirrored from /Users/himeshr/Avni/Tanuh/Tanuh_UAT.
// The Avni API serializes observation keys by concept *name*, so call sites
// read by name; the UUIDs are retained for endpoints that require them.

export const SUBJECT_TYPE = {
  individual: "f3564fac-2e00-4b12-b8d7-c3851db59b6b",
} as const;

export const ENCOUNTER_TYPE = {
  oralScreening: {
    name: "Oral Screening",
    uuid: "634a9542-a37e-461a-83bc-fc8226d6d5cb",
  },
  physicianReviewForm: {
    name: "Clinician Review Form",
    uuid: "714c98f6-3899-4cdc-8036-b683842b8991",
  },
  // Requirements 2.0 Case Updates: when a review resolves to High Risk, the
  // webapp schedules this visit for the screening worker (it appears on
  // mobile in a visit list named after this encounter type). Deployed by
  // ~/Desktop/Avni/tools/build_high_risk_followup_bundle.py.
  highRiskFollowUp: {
    name: "High Risk Follow-up",
    uuid: "805a9993-627e-5c65-bd18-6913a0936a65",
  },
  // Prefilled referral document the field worker hands the patient. Offered as an
  // unplanned visit by an eligibility rule on the encounter type; the webapp also
  // schedules it on a High Risk review so it surfaces under Visits Planned instead
  // of the worker hunting for it under "New Form" (SCRUM-37).
  referralSlip: {
    name: "Referral Slip",
    uuid: "6e74e8e0-ee1c-5004-b730-dba097da4cfe",
  },
} as const;

export const FORM = {
  oralScreeningEncounter: "ff0eb012-201b-4d4a-b4cb-ad2d35e68224",
  physicianReviewForm: "fc903c40-a785-5182-a091-cf50627975c4",
  patientRegistration: "ba9b4f1c-cb8a-4908-bc6e-f42c5611fd8a",
} as const;

export const HABIT_CONCEPTS = {
  cigarettesBidi: { name: "Cigarettes / Bidi Usage", uuid: "9c605412-2664-4957-b40f-f9a49d560c65" },
  smokelessTobacco: { name: "Smokeless Tobacco Usage", uuid: "ce70e55e-125f-47e6-b9da-c3b946e3f51e" },
  arecaNut: { name: "Areca Nut Consumption", uuid: "76b9246f-a500-456f-a5da-0f098cc58b1e" },
  alcohol: { name: "Alcohol Consumption", uuid: "fca4d070-c113-4d16-abf7-a544ad6bbeb8" },
  alcoholFrequency: { name: "Frequency of Alcohol Consumption", uuid: "0a433bb3-92da-4bbf-a248-c8dadd437220" },
} as const;

// Single Yes/No symptom flag captured on the Oral Screening (Habit
// Questionnaire group). Shown in the review's Symptoms section.
export const SYMPTOMS_CONCEPT = {
  name: "Any Symptoms",
  uuid: "4113f78c-756b-4ea7-b2cd-c92cfa9ed369",
} as const;

// Unique tracking identifier written by each encounter form's decision rule:
// <Patient ID><type code><nnn>, zero-padded to 3 (e.g. P0123ORA002 = patient
// 123's 2nd Oral Screening). Patients with no Patient ID — everyone registered
// before the identifier pool existed — fall back to a <subject uuid tail>
// prefix (e.g. 18A1B2ORA002), which is stable across that patient's encounters
// so their cases still group and sort together.
//
// The sequence is max(prior encounters of the type, highest suffix already
// issued) + 1, so voiding a mid-sequence encounter cannot cause a number to be
// re-issued. Ids issued before this webapp's v1.9 are unpadded (P0123ORA2) and
// both forms coexist — canonicalise before comparing or searching.
//
// Deployed by ~/Avni/tools/build_encounter_id_bundle_v4.py. Rules only run on
// mobile; for Clinician Reviews completed here, ReviewForm writes the id
// itself at submit using the same sequence scheme (computeNextEncounterId).
export const ENCOUNTER_ID_CONCEPT = {
  name: "Encounter ID",
  uuid: "503a1c90-a8e0-5914-b4ca-66da90b0a9d2",
} as const;

// The subject's pool-issued identifier (e.g. P0123), written at registration
// on mobile from the "Patient ID" identifier source. Prefix of every
// Encounter ID; subjects registered while the pool was empty have none.
export const PATIENT_ID_CONCEPT = {
  name: "Patient ID",
  uuid: "de560361-145a-51fa-b0bb-944686b8087e",
} as const;

// Written by this webapp onto a completed review: the UUID (`ID`) of the Oral
// Screening encounter that review covered. A subject can have several
// screenings, each scheduling its own review, but Avni scheduled visits carry
// no link back to the screening that triggered them — so without this stamp the
// list can only fall back to the subject's *latest* screening for every review,
// making a subject's multiple reviews all show the same Case ID. This concept
// (deployed by ~/Avni/tools/build_review_source_concept_bundle.py) is the
// permanent per-review→screening link; unstamped legacy/pending reviews fall
// back to created-order index pairing.
export const REVIEWED_ORAL_SCREENING_CONCEPT = {
  name: "Reviewed Oral Screening",
  uuid: "f3c97f76-24a2-54f9-aa77-c71f111e9b71",
} as const;

export const PHOTO_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
export type PhotoSlot = (typeof PHOTO_SLOTS)[number];

export type ConceptRef = { name: string; uuid: string; legacyNames?: readonly string[] };

type PhotoConceptTriple = {
  image: ConceptRef;
  healthWorkerVerdict: ConceptRef;
  aiVerdict: ConceptRef;
  physicianVerdict: ConceptRef;
};

export const PHOTO_CONCEPTS: Record<PhotoSlot, PhotoConceptTriple> = {
  1: {
    image: { name: "Photo 1 (image)", uuid: "91786336-e37d-4b51-8821-ce876516d569" },
    healthWorkerVerdict: {
      name: "Photo 1 — Health Worker verdict",
      uuid: "0db68b48-76ef-4a62-9b83-5e70f04baddb",
      legacyNames: ["Photo 1 — ASHA verdict"],
    },
    aiVerdict: { name: "Photo 1 — AI verdict", uuid: "445fd649-edca-407e-bd91-52261af21ed6" },
    physicianVerdict: { name: "Photo 1 — Physician verdict", uuid: "bb269cd5-71a9-5c9c-be68-bce850b0b3f5" },
  },
  2: {
    image: { name: "Photo 2 (image)", uuid: "b303d744-7362-4b35-94e8-336b18aba0f0" },
    healthWorkerVerdict: {
      name: "Photo 2 — Health Worker verdict",
      uuid: "3566b0f6-29e7-488d-ba0b-cbb022b79c8a",
      legacyNames: ["Photo 2 — ASHA verdict"],
    },
    aiVerdict: { name: "Photo 2 — AI verdict", uuid: "5a48d4a7-6274-467a-97de-043415eee927" },
    physicianVerdict: { name: "Photo 2 — Physician verdict", uuid: "73440ec9-7e87-5e7f-b813-be0737dc9304" },
  },
  3: {
    image: { name: "Photo 3 (image)", uuid: "d2fde9e9-81de-46cf-9215-93ab4e5e7f76" },
    healthWorkerVerdict: {
      name: "Photo 3 — Health Worker verdict",
      uuid: "4a663f81-0ea7-44b1-856b-ea62bb887d50",
      legacyNames: ["Photo 3 — ASHA verdict"],
    },
    aiVerdict: { name: "Photo 3 — AI verdict", uuid: "a5cf68c1-2050-42e3-a161-bc2872961367" },
    physicianVerdict: { name: "Photo 3 — Physician verdict", uuid: "bdaaa0d9-d1a8-5ecf-8553-b960c1585cbd" },
  },
  4: {
    image: { name: "Photo 4 (image)", uuid: "598f3d7e-a4ac-4c48-ae6e-2a5de50a66c1" },
    healthWorkerVerdict: {
      name: "Photo 4 — Health Worker verdict",
      uuid: "571d8d5f-25c1-446d-bf40-69e4a5e96335",
      legacyNames: ["Photo 4 — ASHA verdict"],
    },
    aiVerdict: { name: "Photo 4 — AI verdict", uuid: "da76bab8-dfc1-4a88-bbe4-2f08e23816df" },
    physicianVerdict: { name: "Photo 4 — Physician verdict", uuid: "e7084836-6218-5ac4-af1e-872a45852adb" },
  },
  5: {
    image: { name: "Photo 5 (image)", uuid: "a6d70ebe-becd-4a63-95df-6908bd1f392f" },
    healthWorkerVerdict: {
      name: "Photo 5 — Health Worker verdict",
      uuid: "2df1a200-5c62-4f5d-a950-b12dd59215ec",
      legacyNames: ["Photo 5 — ASHA verdict"],
    },
    aiVerdict: { name: "Photo 5 — AI verdict", uuid: "f14f7fc1-d937-4cff-a536-738a8be3907d" },
    physicianVerdict: { name: "Photo 5 — Physician verdict", uuid: "b713eb1b-3ee2-51ea-9c7c-ae8501becc1c" },
  },
  6: {
    image: { name: "Photo 6 (image)", uuid: "0ebd94e0-33e7-414d-a52b-77c5be2988b0" },
    healthWorkerVerdict: {
      name: "Photo 6 — Health Worker verdict",
      uuid: "b9eb0715-65b2-4d35-aee7-f2fd0b37d3d7",
      legacyNames: ["Photo 6 — ASHA verdict"],
    },
    aiVerdict: { name: "Photo 6 — AI verdict", uuid: "f070b97f-eaf9-417e-aaf4-ec227a8c27da" },
    physicianVerdict: { name: "Photo 6 — Physician verdict", uuid: "ba0c4c49-037d-5d5b-a6f1-52fdcf434c4e" },
  },
  7: {
    image: { name: "Photo 7 (image)", uuid: "3e1eb8b8-c1f9-4e54-8572-733229f9cfbf" },
    healthWorkerVerdict: {
      name: "Photo 7 — Health Worker verdict",
      uuid: "cdee6a2e-403c-49a2-9597-ebf9e910c4d8",
      legacyNames: ["Photo 7 — ASHA verdict"],
    },
    aiVerdict: { name: "Photo 7 — AI verdict", uuid: "e3d312eb-ea3b-42df-a907-1ce1a632adab" },
    physicianVerdict: { name: "Photo 7 — Physician verdict", uuid: "7fc17439-3d24-56a9-962f-16939d1f18fa" },
  },
  8: {
    image: { name: "Photo 8 (image)", uuid: "94c110d1-aca5-429c-9670-20a87e191a93" },
    healthWorkerVerdict: {
      name: "Photo 8 — Health Worker verdict",
      uuid: "c2d9e387-6f6e-482e-854e-9be3147cb8a4",
      legacyNames: ["Photo 8 — ASHA verdict"],
    },
    aiVerdict: { name: "Photo 8 — AI verdict", uuid: "b7a7daf4-c9eb-49be-a67d-50d92cd2b709" },
    physicianVerdict: { name: "Photo 8 — Physician verdict", uuid: "4744031c-634d-5259-9084-fc236847fcb4" },
  },
};

// Reads by primary name, falling back to legacyNames — bridges a server-side
// rename in progress (e.g. ASHA → Health Worker on photo verdicts).
export function readObs<T = unknown>(observations: Record<string, unknown>, ref: ConceptRef): T | undefined {
  const v = observations[ref.name];
  if (v !== undefined && v !== null && v !== "") return v as T;
  for (const legacy of ref.legacyNames ?? []) {
    const lv = observations[legacy];
    if (lv !== undefined && lv !== null && lv !== "") return lv as T;
  }
  return undefined;
}

// Answer-concept names for the photo Physician verdict and the computed
// "Suspicious / Non-suspicious" classification. Both use these exact answers in
// the Tanuh UAT bundle (note the hyphen + capital S in "Non-Suspicious").
export const VERDICT_VALUES = {
  suspicious: "Suspicious",
  nonSuspicious: "Non-Suspicious",
} as const;

export const REVIEW_CONCEPTS = {
  // Requirements 2.0: this concept was renamed in the bundle from
  // "Any image suspicious?" (UUID unchanged); answers are now
  // Suspicious / Non-Suspicious (was Yes/No). legacyNames lets prefill read
  // pre-2.0 completed reviews that stored the old name.
  classification: {
    name: "Suspicious / Non-suspicious",
    uuid: "51bac160-7519-5785-ac8e-d0ca709d9f6e",
    legacyNames: ["Any image suspicious?"],
  },
  // 2.0 tele-specialist diagnosis (single-select) + dependent sub-type + the
  // auto-derived risk band. Recommended action is also auto-derived (mapping).
  provisionalDiagnosis: { name: "Provisional diagnosis", uuid: "ba5490a4-dd03-430d-9ed6-b6435941fbcf" },
  provisionalSubType: { name: "Provisional diagnosis sub-type", uuid: "a2dd1cb8-7786-4975-a746-3b8c09ec5f64" },
  highLowRisk: { name: "High-risk / Low-risk", uuid: "4db6e2a7-2ca8-542f-859e-16458c02efca" },
  // Deprecated: the OPMD multi-select was voided on the form in 2.0 and replaced
  // by Provisional diagnosis. Retained only so pre-2.0 completed reviews parse.
  opmdDiagnoses: { name: "OPMD diagnoses", uuid: "fe8f2ce1-9389-5b9c-871e-87fbc36303d5" },
  recommendedAction: { name: "Recommended action", uuid: "10105f46-0a2c-594e-aeca-651c0b84606c" },
  notes: {
    name: "Notes for ASHA / patient",
    uuid: "f4f82263-c4e8-5e3e-8011-bd5495bccc2d",
    legacyNames: ["Notes for Health Worker / patient"],
  },
  reviewTimestamp: { name: "Review timestamp", uuid: "cf73c280-7505-5263-958c-81acb3b7a943" },
} as const;

// The Oral Screening encounter now captures images via a *repeatable* QuestionGroup:
// each repeat is one photo serialized (by the avni-server external API) as an object
// keyed by child-concept name — `{ "Oral Image": <media-url>, "AI verdict": <answer> }`.
// The whole group is an array under ORAL_IMAGE_GROUP.name. This replaces the legacy
// flat `Photo N (image)` keys (still read as a fallback for older encounters).
export const ORAL_IMAGE_GROUP = {
  name: "Take photos of all lesions and 1 photo without lesion",
  uuid: "f35da603-8499-4478-bc1e-be37d45fe5d1",
} as const;

export const ORAL_IMAGE_GROUP_CHILD = {
  image: { name: "Oral Image", uuid: "f18c5264-3459-4233-87b4-4f9cb3c3ef49" },
  // Legacy: the AI verdict used to live inside each image row. That child
  // concept is now voided on the Oral Screening form — verdicts moved to the
  // parallel AI_VERDICT_GROUP below. Retained only as a fallback for encounters
  // captured before the split.
  aiVerdict: { name: "AI verdict", uuid: "057419d6-18f0-434e-993b-53e2ca76945d" },
} as const;

// A SECOND active repeatable capture group on the Oral Screening form. The
// capture flow branches on "Do you see any lesions?": one branch records images
// under ORAL_IMAGE_GROUP, the other under this group — so a given encounter has
// its photos in exactly one of the two. Its children share the same concept
// names as ORAL_IMAGE_GROUP (notably "Oral Image"), so the same per-entry
// extraction works; images land under `obs["ORAL SCREENING"]`.
export const ORAL_SCREENING_GROUP = {
  name: "ORAL SCREENING",
  uuid: "11941068-57a3-4df1-975b-1beb12d7656d",
} as const;

// AI verdicts are written into their OWN repeatable QuestionGroup by the
// on-device edge-model inference (scheduleImageInferenceIntoGroup), serialized
// under the group concept name as an array of `{ "AI Verdict": <answer> }`,
// one row per image, aligned by index to ORAL_IMAGE_GROUP. The group concept is
// "Image-wise AI Assessment"; the child verdict concept is "AI Verdict";
// answers are "Suspicious" / "Non-Suspicious". Defined for completeness — the AI
// verdict is intentionally not surfaced in the physician review (2.0).
export const AI_VERDICT_GROUP = {
  name: "Image-wise AI Assessment",
  uuid: "c98378f6-e167-4baf-8804-e04aa2cb6b8e",
} as const;

export const AI_VERDICT_GROUP_CHILD = {
  // Canonical verdict child, populated by on-device edge-model inference with
  // "Suspicious" / "Non-Suspicious". Encounters where inference never ran and a
  // stray "yes/no" child was filled instead are junk test data being voided in
  // the org, so they are deliberately not read here.
  verdict: { name: "AI Verdict", uuid: "d2d5ea23-3031-4bae-9f4a-bb04d5be3286" },
} as const;

// Requirements 2.0: the Physician Review Form stores per-photo verdicts in its
// OWN repeatable QuestionGroup ("Images"), replacing the flat per-slot
// `Photo N — Physician verdict` concepts (their form elements are now voided).
// Written as an array of rows, one per reviewed photo: each carries the photo's
// "Oral Image" media URL (copied from the screening, so the mobile dashboard can
// render the thumbnail beside its verdict) plus quality/verdict/highest-risk.
export const REVIEW_IMAGE_GROUP = {
  name: "Images",
  uuid: "483cc24f-7781-4f4a-a257-f7fa842a5371",
} as const;

export const REVIEW_IMAGE_GROUP_CHILD = {
  image: { name: "Oral Image", uuid: "f18c5264-3459-4233-87b4-4f9cb3c3ef49" },
  // Per-photo image-quality gate. "No" means the photo is not assessable, so the
  // Clinician diagnosis verdict is disabled/skipped for that photo. Reuses the
  // org's canonical Yes/No answer concepts.
  acceptableQuality: { name: "Acceptable Quality of the photo?", uuid: "f6744e13-a39f-515b-8712-4b1ddc32e7b8" },
  physicianVerdict: { name: "Physician verdict", uuid: "115099a3-af32-41b2-86f8-a707a648a0ec" },
  // Single photo flagged as highest-risk across the set; stored as "Yes" on that
  // one row only. Reuses the org's canonical Yes/No answer concepts.
  highestRiskPhoto: { name: "Highest Risk Photo?", uuid: "6d83bbd4-feb6-5647-a917-b6ba19b98914" },
} as const;

// Per-photo "Acceptable Quality?" answer values (canonical Yes/No).
export const QUALITY_VALUES = { yes: "Yes", no: "No" } as const;

// True when an Oral Screening uses the legacy flat photo layout (`Photo N (image)`
// keys) instead of the current repeatable QuestionGroup. Such encounters are not
// supported for review and are shown read-only with a warning. New repeatable
// encounters return false. Encounters with neither layout (no photos) also return
// false — no warning, the empty-state path handles them.
export function isLegacyOralScreening(obs: Record<string, unknown>): boolean {
  // current repeatable config — images live in either capture group
  if (Array.isArray(obs[ORAL_IMAGE_GROUP.name]) || Array.isArray(obs[ORAL_SCREENING_GROUP.name]))
    return false;
  return PHOTO_SLOTS.some((slot) => {
    const v = obs[PHOTO_CONCEPTS[slot].image.name];
    return typeof v === "string" && v !== "";
  });
}

// Oral Visual Examination findings on the Oral Screening encounter. The bundle's
// skip logic makes these mutually exclusive paths: "Do you see any lesions?" is
// asked only when the mouth opens; the referral acknowledgment (a mandatory
// Yes-only radio) is recorded only when it does not — such encounters carry no
// images at all, so the review must lean on these instead.
export const VISUAL_EXAM_CONCEPTS = {
  ableToOpenMouth: { name: "Able to Open Mouth?", uuid: "6be1c060-14da-4c5c-a4ef-7d8a1c920de1" },
  seeAnyLesions: { name: "Do you see any lesions?", uuid: "bcf70ad2-ffed-413e-9f48-e3ab36757208" },
  referralRequiredLimitedMouth: {
    name: "Referral is required due to limited mouth opening",
    uuid: "49d59a0e-458c-4e7d-a2ae-3e2928f98e5d",
  },
} as const;

// Per-image "Suspicious Lesion?" question, a child of the capture QuestionGroups.
export const ANY_SUSPICIOUS_LESION_CONCEPT = {
  name: "Suspicious Lesion?",
  uuid: "51192767-e702-4122-84e6-768c1cfbc001",
} as const;

// "Place of referral" is a Location-typed concept on the Oral Screening encounter.
// The observation value is an AddressLevel uuid pointing at a referral facility —
// one of the parallel (non-nested) facility types District Hospital / Taluka
// Hospital / Public Health Center. Used by the Pending list to filter by referral
// facility via the server's linked-observation filter.
export const PLACE_OF_REFERRAL_CONCEPT = {
  name: "Place of referral",
  uuid: "4a43f83e-26db-40c8-83d8-4317dcfda913",
} as const;
