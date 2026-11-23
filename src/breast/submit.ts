// Saving a clinician form to Avni: as a new visit on the woman, as the completion of a visit that
// was booked, or as an update to one already submitted. The app runs the form's show/hide rules
// but not its decision or visit-schedule rules (Avni's web form response does not carry them), so
// the two things those rules do for these forms are done here, as the oral review already does:
// the Encounter ID, and booking the Clinician Assessment after the additional assessment.
import { computeNextEncounterId, type UpsertEncounterBody } from "@/api/encounters";
import type { ScheduleEncounterBody } from "@/api/scheduledVisit";
import type { EncounterApiResponse, SubjectApiResponse } from "@/api/types";
import { ENCOUNTER_ID_CONCEPT, PATIENT_ID_CONCEPT, readObs } from "@/constants/tanuhConcepts";
import { buildObservations } from "@/forms/engine/answers";
import type { FormDef } from "@/forms/engine/formDef";
import type { FormView } from "@/forms/engine/formState";
import { isVisible } from "@/forms/engine/ruleRunner";
import { BREAST_VISITS, type ClinicianFormKey } from "./breastConcepts";

export interface SubmitInput {
  formKey: ClinicianFormKey;
  form: FormDef;
  view: FormView;
  subject: SubjectApiResponse;
  screening: EncounterApiResponse;
  /** The visit this save writes to: one already submitted, or one booked and open. Null creates one. */
  existing: EncounterApiResponse | null;
  /** The woman's visits of this form's type, for numbering. */
  siblings: EncounterApiResponse[];
  /** A Clinician Assessment is already booked and open for her. */
  openClinicianVisit: boolean;
  now: Date;
}

export interface SubmitDeps {
  submit: (uuid: string | null, body: UpsertEncounterBody) => Promise<EncounterApiResponse>;
  schedule: (visit: ScheduleEncounterBody) => Promise<void>;
  /** Called once the form is in Avni: drop the draft, refresh the lists. */
  onSaved: () => void;
}

export type SubmitResult = { ok: true; warning: string | null } | { ok: false; message: string };

export function buildSubmission(input: SubmitInput): { uuid: string | null; body: UpsertEncounterBody } {
  const visit = BREAST_VISITS[input.formKey];
  const { existing } = input;
  const submitted = existing?.["Encounter date time"] ?? null;
  const observations = buildObservations(
    input.form,
    (element, row) => isVisible(input.view.statuses, element, row),
    input.view.answers,
  );
  const encounterId =
    (submitted ? readObs<string>(existing?.observations ?? {}, ENCOUNTER_ID_CONCEPT) : undefined) ??
    computeNextEncounterId(
      readObs<string>(input.subject.observations ?? {}, PATIENT_ID_CONCEPT),
      visit.idCode,
      input.siblings,
      existing?.ID ?? "",
    );
  if (encounterId) observations[ENCOUNTER_ID_CONCEPT.name] = encounterId;
  const body: UpsertEncounterBody = {
    "Encounter type": visit.name,
    "Subject ID": input.subject.ID,
    "Encounter date time": submitted ?? input.now.toISOString(),
    observations,
  };
  if (existing) {
    body["Earliest scheduled date"] = existing["Earliest scheduled date"];
    body["Max scheduled date"] = existing["Max scheduled date"];
  } else {
    // The create is keyed on this, so a retry after a lost reply updates the same visit.
    body["External ID"] = `breast-${input.formKey}-${input.screening.ID}`;
  }
  return { uuid: existing?.ID ?? null, body };
}

function failure(err: unknown): string {
  const e = err as { isAxiosError?: boolean; response?: { status?: number; data?: unknown }; message?: string };
  if (e?.isAxiosError && !e.response) return "No connection. Your answers are kept; try again.";
  if (e?.response?.status === 401) return "Your session has ended. Sign in again; your answers are kept in this browser.";
  if (e?.response?.status === 403) return "Your account is not allowed to save this form. Your answers are kept.";
  const data = e?.response?.data;
  const detail =
    typeof data === "string" ? data : ((data as { message?: string; errorMessage?: string } | undefined)?.message ??
        (data as { errorMessage?: string } | undefined)?.errorMessage);
  return `Avni did not save the form${detail ? `: ${detail}` : e?.message ? `: ${e.message}` : ""}. Your answers are kept; try again.`;
}

const startOfUtcDay = (d: Date): Date => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

export async function submitClinicianForm(input: SubmitInput, deps: SubmitDeps): Promise<SubmitResult> {
  const { uuid, body } = buildSubmission(input);
  try {
    await deps.submit(uuid, body);
  } catch (err) {
    return { ok: false, message: failure(err) };
  }
  deps.onSaved();
  // As the form's visit-schedule rule does on the phone: due today, overdue after seven days.
  const firstAssessment = input.formKey === "assessment" && !input.existing?.["Encounter date time"];
  if (!firstAssessment || input.openClinicianVisit) return { ok: true, warning: null };
  const earliest = startOfUtcDay(input.now);
  const max = new Date(earliest.getTime() + 8 * 86400000 - 1);
  try {
    await deps.schedule({
      encounterType: { name: BREAST_VISITS.clinician.name, uuid: BREAST_VISITS.clinician.uuid },
      subjectId: input.subject.ID,
      earliestVisitDateTime: earliest.toISOString(),
      maxVisitDateTime: max.toISOString(),
    });
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    return {
      ok: true,
      warning: `Saved. The Clinician Assessment visit could not be booked in Avni (${why}); it can still be filled here.`,
    };
  }
  return { ok: true, warning: null };
}
