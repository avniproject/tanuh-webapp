/**
 * The 15 OPMD options shown as the OPMD diagnoses MultiSelect.
 * The display labels here MUST match concept-answer names in the Tanuh
 * Avni org so submission picks up the right answer-concept UUIDs.
 *
 * Source: user brief (18 May 2026).
 */
export const OPMD_OPTIONS = [
  "Leukoplakia",
  "Erythroplakia",
  "Erythroleukoplakia (Speckled leukoplakia)",
  "Proliferative Verrucous Leukoplakia (PVL)",
  "Oral Submucous Fibrosis (OSMF)",
  "Oral Lichen Planus (OLP)",
  "Oral Lichenoid Lesions (OLLs)",
  "Actinic Cheilitis (Actinic keratosis of the lip)",
  "Palatal Lesions associated with Reverse Smoking",
  "Oral Lupus Erythematosus (including Discoid Lupus Erythematosus)",
  "Dyskeratosis Congenita",
  "Oral Graft-versus-Host Disease (GVHD)",
  "Epidermolysis Bullosa",
  "Xeroderma Pigmentosum",
  "Plummer-Vinson Syndrome (Sideropenic dysphagia)",
] as const;
