// Requirements 2.0 — Physician Review Form auto-derivation.
//
// A provisional diagnosis (and, for "Non-homogeneous leukoplakia", its sub-type)
// determines three downstream values that the physician does NOT pick manually:
//   - Classification: Suspicious / Non-Suspicious
//   - Risk band:      High Risk / Low-risk
//   - Recommended action: No action / Lifestyle counselling only / Biopsy at hospital
//
// Values below are the EXACT answer-concept names from the Tanuh UAT bundle —
// observations are written by name, so any casing drift ("No action" vs
// "No Action", "High Risk" vs "High-risk") would silently fail to map. Do not
// "tidy" these strings.
//
// Edge cases:
//   - "Oral submucosal fibrosis" maps to "Not applicable" for all three (null here).
//   - "Non-homogeneous leukoplakia" has no row of its own: classification is
//     known (Suspicious) but risk/action resolve only once a sub-type is chosen.

export const CLASSIFICATION = {
  suspicious: "Suspicious",
  nonSuspicious: "Non-Suspicious",
} as const;

export const RISK = {
  high: "High Risk",
  low: "Low-risk",
} as const;

export const ACTION = {
  none: "No action",
  lifestyle: "Lifestyle counselling only",
  biopsy: "Biopsy at hospital",
} as const;

// The one diagnosis that opens the dependent sub-type dropdown.
export const NON_HOMOGENEOUS_LEUKOPLAKIA = "Non-homogeneous leukoplakia";

export interface DiagnosisMapping {
  classification: string | null; // null = "Not applicable"
  risk: string | null;
  action: string | null;
}

// Leaf diagnoses (everything except Non-homogeneous leukoplakia, which is
// resolved via its sub-type).
const DIAGNOSIS_MAP: Record<string, DiagnosisMapping> = {
  "Oral cavity normal": { classification: CLASSIFICATION.nonSuspicious, risk: RISK.low, action: ACTION.none },
  Benign: { classification: CLASSIFICATION.nonSuspicious, risk: RISK.low, action: ACTION.lifestyle },
  Other: { classification: CLASSIFICATION.nonSuspicious, risk: RISK.low, action: ACTION.none },
  "Smokeless tobacco keratosis": { classification: CLASSIFICATION.suspicious, risk: RISK.low, action: ACTION.lifestyle },
  "Homogenous oral leukoplakia": { classification: CLASSIFICATION.suspicious, risk: RISK.low, action: ACTION.lifestyle },
  "Oral submucosal fibrosis": { classification: null, risk: null, action: null }, // Not applicable
  "Oral Lichen Planus (OLP)": { classification: CLASSIFICATION.suspicious, risk: RISK.low, action: ACTION.lifestyle },
  "Squamous cell carcinoma of oral mucous membrane": {
    classification: CLASSIFICATION.suspicious,
    risk: RISK.high,
    action: ACTION.biopsy,
  },
};

// All Non-homogeneous leukoplakia sub-types resolve identically.
const SUBTYPE_MAP: Record<string, DiagnosisMapping> = {
  "Speckled oral leukoplakia": { classification: CLASSIFICATION.suspicious, risk: RISK.high, action: ACTION.biopsy },
  Erythroplakia: { classification: CLASSIFICATION.suspicious, risk: RISK.high, action: ACTION.biopsy },
  "Verrucous oral leukoplakia": { classification: CLASSIFICATION.suspicious, risk: RISK.high, action: ACTION.biopsy },
  "Proliferative Verrucous Leukoplakia (PVL)": {
    classification: CLASSIFICATION.suspicious,
    risk: RISK.high,
    action: ACTION.biopsy,
  },
};

// Resolve the derived values for a (diagnosis, subType) selection.
// Returns null when no diagnosis is chosen. For Non-homogeneous leukoplakia with
// no sub-type yet, classification is known but risk/action are still null.
export function lookupDiagnosis(diagnosis: string, subType?: string): DiagnosisMapping | null {
  if (!diagnosis) return null;
  if (diagnosis === NON_HOMOGENEOUS_LEUKOPLAKIA) {
    if (subType && SUBTYPE_MAP[subType]) return SUBTYPE_MAP[subType];
    return { classification: CLASSIFICATION.suspicious, risk: null, action: null };
  }
  return DIAGNOSIS_MAP[diagnosis] ?? null;
}

// Classification a diagnosis implies, used to filter the diagnosis dropdown by
// the photo-derived classification. null = "Not applicable" (e.g. OSMF), which
// the caller treats as "always show".
export function classificationOf(diagnosis: string): string | null {
  if (diagnosis === NON_HOMOGENEOUS_LEUKOPLAKIA) return CLASSIFICATION.suspicious;
  return DIAGNOSIS_MAP[diagnosis]?.classification ?? null;
}

// True once the selection resolves to a High Risk band — drives the
// "High Risk Follow-up" task (pending a Task API; see project notes).
export function isHighRisk(diagnosis: string, subType?: string): boolean {
  return lookupDiagnosis(diagnosis, subType)?.risk === RISK.high;
}
