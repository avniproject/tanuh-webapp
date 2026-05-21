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
    name: "Physician Review Form",
    uuid: "714c98f6-3899-4cdc-8036-b683842b8991",
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

export const PHOTO_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
export type PhotoSlot = (typeof PHOTO_SLOTS)[number];

export type ConceptRef = { name: string; uuid: string; legacyNames?: string[] };

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

// Answer-concept names used to compute the "Any image suspicious?" field.
// Must match the answer names in the Tanuh_UAT bundle.
export const VERDICT_VALUES = {
  suspicious: "Suspicious",
  yes: "Yes",
  no: "No",
} as const;

export const REVIEW_CONCEPTS = {
  anyImageSuspicious: { name: "Any image suspicious?", uuid: "51bac160-7519-5785-ac8e-d0ca709d9f6e" },
  opmdDiagnoses: { name: "OPMD diagnoses", uuid: "fe8f2ce1-9389-5b9c-871e-87fbc36303d5" },
  recommendedAction: { name: "Recommended action", uuid: "10105f46-0a2c-594e-aeca-651c0b84606c" },
  notes: { name: "Notes for Health Worker / patient", uuid: "f4f82263-c4e8-5e3e-8011-bd5495bccc2d" },
  reviewTimestamp: { name: "Review timestamp", uuid: "cf73c280-7505-5263-958c-81acb3b7a943" },
} as const;

// "Place of referral" is a Location-typed concept on the Oral Screening encounter.
// The observation value is an AddressLevel uuid pointing into the facility branch
// (District Hospital → CHC → PHC → Sub-center). Used by the Pending list to
// filter by referral facility via the server's linked-observation filter.
export const PLACE_OF_REFERRAL_CONCEPT = {
  name: "Place of referral",
  uuid: "4a43f83e-26db-40c8-83d8-4317dcfda913",
} as const;
