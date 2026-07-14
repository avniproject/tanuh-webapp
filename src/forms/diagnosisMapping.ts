// Clinician Review — diagnosis auto-derivation (per the Clinician Review user
// stories).
//
// A provisional diagnosis (and, for "Non-homogeneous leukoplakia", its sub-type)
// determines three downstream values that the clinician does NOT pick manually:
//   - Classification: Suspicious / Non-Suspicious
//   - Risk band:      High Risk / Low-risk
//   - Recommended action:
//       * Non-suspicious           -> "Follow-up for Dentist Visit"
//       * Suspicious + Low-risk     -> "Visit Dentist for Routine Check-up"
//       * Suspicious + High Risk    -> "Urgent Visit to Dental Hospital"
//
// Values below are the EXACT answer-concept names from the Tanuh UAT bundle —
// observations are written by name, so any casing drift ("High Risk" vs
// "High-risk") would silently fail to map. Do not "tidy" these strings. The 3
// action strings were added as answers of the "Recommended action" concept in
// the Tanuh_UAT_recommended_actions bundle.
//
// Edge case:
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
  dentistFollowUp: "Follow-up for Dentist Visit", // non-suspicious
  routineCheckup: "Visit Dentist for Routine Check-up", // suspicious + low-risk
  urgentHospital: "Urgent Visit to Dental Hospital", // high-risk
} as const;

// The one diagnosis that opens the dependent sub-type dropdown.
export const NON_HOMOGENEOUS_LEUKOPLAKIA = "Non-homogeneous leukoplakia";

// Limited-mouth-opening reviews carry no images, so the clinician does not
// diagnose — these fixed values are pre-populated instead (Tanuh spec,
// 2026-07-06). "N/A" was added as an answer of the Provisional diagnosis
// concept in the bundle for exactly this; it must never appear in the
// diagnosis dropdown on the normal photo path. Note the deliberate spec
// combination: High Risk with the dentist-visit action (not the biopsy one),
// so lookupDiagnosis("N/A") returning null keeps the High Risk Follow-up
// (biopsy) visit from being scheduled on this path.
export const LIMITED_MOUTH_REVIEW = {
  classification: CLASSIFICATION.suspicious,
  diagnosis: "N/A",
  risk: RISK.high,
  action: ACTION.dentistFollowUp,
} as const;

export interface DiagnosisMapping {
  classification: string | null; // null = "Not applicable"
  risk: string | null;
  action: string | null;
}

// Leaf diagnoses (everything except Non-homogeneous leukoplakia, which is
// resolved via its sub-type).
const DIAGNOSIS_MAP: Record<string, DiagnosisMapping> = {
  "Oral cavity normal": { classification: CLASSIFICATION.nonSuspicious, risk: RISK.low, action: ACTION.dentistFollowUp },
  Benign: { classification: CLASSIFICATION.nonSuspicious, risk: RISK.low, action: ACTION.dentistFollowUp },
  Other: { classification: CLASSIFICATION.nonSuspicious, risk: RISK.low, action: ACTION.dentistFollowUp },
  "Smokeless tobacco keratosis": { classification: CLASSIFICATION.suspicious, risk: RISK.low, action: ACTION.routineCheckup },
  "Homogenous oral leukoplakia": { classification: CLASSIFICATION.suspicious, risk: RISK.low, action: ACTION.routineCheckup },
  "Oral submucosal fibrosis": { classification: CLASSIFICATION.suspicious, risk: RISK.low, action: ACTION.routineCheckup },
  "Oral Lichen Planus (OLP)": { classification: CLASSIFICATION.suspicious, risk: RISK.low, action: ACTION.routineCheckup },
  "Squamous cell carcinoma of oral mucous membrane": {
    classification: CLASSIFICATION.suspicious,
    risk: RISK.high,
    action: ACTION.urgentHospital,
  },
};

// All Non-homogeneous leukoplakia sub-types resolve identically (Suspicious,
// High Risk).
const SUBTYPE_MAP: Record<string, DiagnosisMapping> = {
  "Speckled oral leukoplakia": { classification: CLASSIFICATION.suspicious, risk: RISK.high, action: ACTION.urgentHospital },
  Erythroplakia: { classification: CLASSIFICATION.suspicious, risk: RISK.high, action: ACTION.urgentHospital },
  "Verrucous oral leukoplakia": { classification: CLASSIFICATION.suspicious, risk: RISK.high, action: ACTION.urgentHospital },
  "Proliferative Verrucous Leukoplakia (PVL)": {
    classification: CLASSIFICATION.suspicious,
    risk: RISK.high,
    action: ACTION.urgentHospital,
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
