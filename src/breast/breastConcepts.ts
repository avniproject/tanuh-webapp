// What the breast module reads by name from Avni. Everything else on the forms comes from the
// form definitions at run time; these are the few names the list and the header need, and the
// visit types the module is built on. They mirror round uat49_breast_general_encounters.

export const BREAST_VISITS = {
  screening: {
    name: "Breast Cancer Screening",
    uuid: "6f68e18e-37fa-5d07-bfa1-1bce583202ec",
    formUuid: "c8708a3b-9d3b-43d8-8d8b-fcf7d2a861ef",
    idCode: "BCS",
  },
  assessment: {
    name: "Breast Cancer Risk Assessment",
    uuid: "3150ee10-1082-5c7a-a886-6fb79f411bac",
    formUuid: "985c8b0d-9787-5345-96ad-81b1af76cc05",
    idCode: "BRA",
  },
  clinician: {
    name: "Breast Clinician Assessment",
    uuid: "41c01d89-08b3-5db7-8274-01cf06018a39",
    formUuid: "b4cbc312-63ce-571a-b84f-fb2d5e0a610d",
    idCode: "BCL",
  },
} as const;

/** The two forms a clinician fills, in the order they are filled. */
export type ClinicianFormKey = "assessment" | "clinician";
export const CLINICIAN_FORMS: Record<ClinicianFormKey, { title: string; submit: string }> = {
  assessment: { title: "Additional assessment", submit: "Submit to Avni" },
  clinician: { title: "Clinician assessment", submit: "Submit assessment" },
};

export const BREAST_OBS = {
  refer: "PS Refer for breast care",
  anySymptoms: "PS Any breast symptoms",
  riskClass: "PS Risk Class",
  riskProbability: "PS Risk Probability",
  riskModel: "PS Risk Model",
  age: "PS Age years",
  referTo: "PS Breast referral - refer to",
  facility: "PS Breast referral facility",
  otherFacility: "PS Breast referral other facility",
  encounterId: "Encounter ID",
} as const;

export const HIGH_RISK = "HIGH RISK";
export const LOW_RISK = "LOW RISK";
