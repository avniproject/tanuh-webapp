import type { EncounterApiResponse } from "@/api/types";
import { BREAST_OBS, BREAST_VISITS, HIGH_RISK, LOW_RISK, type ClinicianFormKey } from "./breastConcepts";

export type FormStatus = "not_started" | "draft" | "submitted";
export type ReferralReason = "Red-flag symptom" | "AI high risk" | "FLW decision";

/** One referred woman: her newest referring screening and where the two clinician forms stand. */
export interface BreastCase {
  screeningUuid: string;
  subjectUuid: string;
  /** Her Patient ID, as the screening's Encounter ID carries it. */
  subjectId: string;
  screenedOn: string;
  age: number | null;
  risk: typeof HIGH_RISK | typeof LOW_RISK | null;
  /** The hospital she was referred to: the picked one, else the name typed in. */
  hospital: string | null;
  reason: ReferralReason;
  assessment: FormStatus;
  clinician: FormStatus;
}

export type CaseFilter = "all" | "awaiting" | "assessed";

/** The key a browser draft is listed under: the screening it belongs to and the form. */
export const draftMark = (screeningUuid: string, form: ClinicianFormKey): string => `${screeningUuid}|${form}`;

const done = (e: EncounterApiResponse): boolean => !e.Voided && e["Encounter date time"] != null;
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

/** A Location answer comes back as {type: title} from the top level down; the last is the place itself. */
export function placeName(value: unknown): string | null {
  if (typeof value === "string") return text(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const titles = Object.values(value as Record<string, unknown>).map(text).filter((t): t is string => !!t);
  return titles.length ? titles[titles.length - 1] : null;
}

function subjectId(screening: EncounterApiResponse): string {
  const encounterId = text(screening.observations?.[BREAST_OBS.encounterId]);
  const match = encounterId?.match(new RegExp(`^(.+?)${BREAST_VISITS.screening.idCode}\\d+$`));
  return match ? match[1] : screening["Subject ID"].slice(0, 8);
}

function reasonOf(obs: Record<string, unknown>): ReferralReason {
  if (obs[BREAST_OBS.anySymptoms] === "Yes") return "Red-flag symptom";
  if (obs[BREAST_OBS.riskClass] === HIGH_RISK) return "AI high risk";
  return "FLW decision";
}

/** The form visit that answers a screening: the newest one of that woman completed at or after it. */
export function formVisitFor(screening: EncounterApiResponse, visits: EncounterApiResponse[]): EncounterApiResponse | null {
  const at = screening["Encounter date time"]!;
  const hits = visits
    .filter((v) => v["Subject ID"] === screening["Subject ID"] && done(v) && v["Encounter date time"]! >= at)
    .sort((a, b) => b["Encounter date time"]!.localeCompare(a["Encounter date time"]!));
  return hits[0] ?? null;
}

function status(
  screening: EncounterApiResponse,
  visits: EncounterApiResponse[],
  form: ClinicianFormKey,
  drafts: ReadonlySet<string>,
): FormStatus {
  if (formVisitFor(screening, visits)) return "submitted";
  return drafts.has(draftMark(screening.ID, form)) ? "draft" : "not_started";
}

/**
 * The breast worklist: every woman whose newest completed screening refers her, newest first. A
 * form counts as submitted only when it was completed at or after that screening, so a woman
 * screened again starts afresh.
 */
export function buildBreastCases(
  screenings: EncounterApiResponse[],
  riskAssessments: EncounterApiResponse[],
  clinicianAssessments: EncounterApiResponse[],
  drafts: ReadonlySet<string>,
): BreastCase[] {
  const newest = new Map<string, EncounterApiResponse>();
  for (const s of screenings) {
    if (!done(s) || s.observations?.[BREAST_OBS.refer] !== "Yes") continue;
    const current = newest.get(s["Subject ID"]);
    if (!current || s["Encounter date time"]! > current["Encounter date time"]!) newest.set(s["Subject ID"], s);
  }
  return [...newest.values()]
    .sort((a, b) => b["Encounter date time"]!.localeCompare(a["Encounter date time"]!))
    .map((s) => {
      const obs = s.observations ?? {};
      const risk = obs[BREAST_OBS.riskClass];
      const age = obs[BREAST_OBS.age];
      return {
        screeningUuid: s.ID,
        subjectUuid: s["Subject ID"],
        subjectId: subjectId(s),
        screenedOn: s["Encounter date time"]!,
        age: typeof age === "number" ? age : null,
        risk: risk === HIGH_RISK || risk === LOW_RISK ? risk : null,
        hospital: placeName(obs[BREAST_OBS.facility]) ?? text(obs[BREAST_OBS.otherFacility]),
        reason: reasonOf(obs),
        assessment: status(s, riskAssessments, "assessment", drafts),
        clinician: status(s, clinicianAssessments, "clinician", drafts),
      };
    });
}

export const isAssessed = (c: BreastCase): boolean => c.assessment === "submitted" && c.clinician === "submitted";

/** How many women still wait: one or both forms not submitted. */
export const pendingCount = (cases: BreastCase[]): number => cases.filter((c) => !isAssessed(c)).length;

export function filterCases(cases: BreastCase[], filter: CaseFilter, search: string): BreastCase[] {
  const q = search.trim().toLowerCase();
  return cases.filter((c) => {
    if (filter === "awaiting" && isAssessed(c)) return false;
    if (filter === "assessed" && !isAssessed(c)) return false;
    if (!q) return true;
    return c.subjectId.toLowerCase().includes(q) || (c.hospital ?? "").toLowerCase().includes(q);
  });
}
