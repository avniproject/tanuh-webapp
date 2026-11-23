// The case page heading. With the review queue on it reads "Case <id>" for a real ID; a patient with
// no ID keeps the neutral "Patient Review" (never "Case Patient Review"). With the queue off it is the
// bare ID, as before.
export function caseHeading(id: string | null | undefined, queueOn: boolean): string {
  const trimmed = id?.trim();
  if (!trimmed) return "Patient Review";
  return queueOn ? `Case ${trimmed}` : trimmed;
}
