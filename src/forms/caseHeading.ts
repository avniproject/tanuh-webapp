// The case page heading. With the review queue on it reads "Case <id>" for a real ID; a patient with
// no ID keeps the neutral "Patient Review" (never "Case Patient Review"). With the queue off it is the
// bare ID, as before. A number stored as the ID reads as its digits; anything else that is not text reads as no ID.
export function caseHeading(id: unknown, queueOn: boolean): string {
  const raw = typeof id === "string" ? id : typeof id === "number" && Number.isFinite(id) ? String(id) : "";
  const trimmed = raw.trim();
  if (!trimmed) return "Patient Review";
  return queueOn ? `Case ${trimmed}` : trimmed;
}
