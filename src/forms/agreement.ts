import { AI_RISK_VALUES } from "@/constants/tanuhConcepts";
import { CLASSIFICATION, RISK } from "./diagnosisMapping";

// tanuh-webapp#5. Whether the clinician agreed with the high-risk model, stored as "High risk model agreement" so
// reports can show how often they agree. The two sides use different answer concepts ("Low-risk" and "Low Risk",
// "Non-Suspicious" and "Non Suspicious"), so the comparison is an explicit table, never string equality.
export const AGREEMENT_VALUES = { match: "Match", mismatch: "Mismatch" } as const;
export type Agreement = (typeof AGREEMENT_VALUES)[keyof typeof AGREEMENT_VALUES];

export function computeAgreement(
  clinicianRisk: string | undefined,
  clinicianClassification: string | undefined,
  modelResult: string | undefined,
): Agreement | null {
  if (!modelResult || !clinicianRisk || !clinicianClassification) return null;
  const knownModel = (Object.values(AI_RISK_VALUES) as string[]).includes(modelResult);
  const knownClassification = clinicianClassification === CLASSIFICATION.suspicious || clinicianClassification === CLASSIFICATION.nonSuspicious;
  if (!knownModel || !knownClassification) return null;
  const agree = (yes: boolean) => (yes ? AGREEMENT_VALUES.match : AGREEMENT_VALUES.mismatch);
  if (clinicianRisk === RISK.high) return agree(modelResult === AI_RISK_VALUES.highRisk);
  if (clinicianRisk !== RISK.low) return null;
  if (modelResult === AI_RISK_VALUES.lowRisk) return AGREEMENT_VALUES.match;
  if (modelResult === AI_RISK_VALUES.highRisk) return AGREEMENT_VALUES.mismatch;
  return agree(clinicianClassification === CLASSIFICATION.nonSuspicious); // the model said Non Suspicious
}
