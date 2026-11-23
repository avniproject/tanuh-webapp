// Saving a clinician form to Avni: as a new visit on the woman, or as a change to a visit that
// exists (one booked and open, or one already submitted). The app runs the form's show/hide rules
// but not its decision or visit-schedule rules (Avni's web form response does not carry them), so
// the two things those rules do for these forms are done here, as the oral review already does:
// the Encounter ID, and booking the Clinician Assessment after the additional assessment.
import { addDays, endOfDay, startOfDay } from "date-fns";
import { computeNextEncounterId, type PatchEncounterBody, type UpsertEncounterBody } from "@/api/encounters";
import type { ScheduleEncounterBody } from "@/api/scheduledVisit";
import type { EncounterApiResponse, SubjectApiResponse } from "@/api/types";
import { ENCOUNTER_ID_CONCEPT, PATIENT_ID_CONCEPT, readObs } from "@/constants/tanuhConcepts";
import { buildObservations, type ReadAnswers } from "@/forms/engine/answers";
import type { ElementDef, FormDef } from "@/forms/engine/formDef";
import { allElements } from "@/forms/engine/formDef";
import type { FormView } from "@/forms/engine/formState";
import { isVisible, statusKey } from "@/forms/engine/ruleRunner";
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
  /** The uuids of the places the form's Location questions offer. */
  placeUuids: ReadonlySet<string>;
  /** The saved visit's answers as they were read, and which questions were not read in full. */
  loaded: ReadAnswers;
  now: Date;
}

export interface SubmitDeps {
  create: (body: UpsertEncounterBody) => Promise<EncounterApiResponse>;
  patch: (uuid: string, body: PatchEncounterBody) => Promise<EncounterApiResponse>;
  /** Read from Avni now: the submitted visit of this form that answers the screening, if any. */
  findSubmitted: () => Promise<EncounterApiResponse | null>;
  schedule: (visit: ScheduleEncounterBody) => Promise<void>;
  /** Called once the form is in Avni: drop the draft, refresh the lists. */
  onSaved: () => void;
}

export type SubmitResult =
  | { ok: true; warning: string | null }
  /** `stale`: Avni holds a submission the page did not know of; the page should reload. */
  | { ok: false; message: string; stale?: boolean };

export type Submission =
  | { kind: "create"; body: UpsertEncounterBody }
  | { kind: "patch"; uuid: string; body: PatchEncounterBody };

const isLocation = (e: ElementDef): boolean => e.concept.dataType === "Location";

export function buildSubmission(input: SubmitInput): Submission {
  const visit = BREAST_VISITS[input.formKey];
  const { existing, form, view } = input;
  const submitted = existing?.["Encounter date time"] ?? null;
  const observations = buildObservations(form, (element, row) => isVisible(view.statuses, element, row), view.answers);
  const same = (e: ElementDef): boolean =>
    JSON.stringify(view.answers[e.concept.uuid] ?? null) === JSON.stringify(input.loaded.answers[e.concept.uuid] ?? null);
  // A question whose saved answer the app did not read in full (a record field or an option the
  // form does not know, a kind of value the app does not handle) is left exactly as Avni has it,
  // unless the clinician changed it here.
  const untouchable = (e: ElementDef): boolean => input.loaded.unmapped.has(e.concept.uuid) && same(e);
  for (const e of allElements(form)) {
    if (e.parentUuid) continue;
    // A Location is stored as an address uuid. A value that is not one of the listed places is the
    // name Avni displayed for the saved answer, and is never sent.
    const notAPlace = isLocation(e) && !input.placeUuids.has(String(observations[e.concept.name]));
    if (notAPlace || untouchable(e)) delete observations[e.concept.name];
  }
  const encounterId =
    (submitted ? readObs<string>(existing?.observations ?? {}, ENCOUNTER_ID_CONCEPT) : undefined) ??
    computeNextEncounterId(
      readObs<string>(input.subject.observations ?? {}, PATIENT_ID_CONCEPT),
      visit.idCode,
      input.siblings,
      existing?.ID ?? "",
    );
  if (encounterId) observations[ENCOUNTER_ID_CONCEPT.name] = encounterId;

  if (!existing) {
    return {
      kind: "create",
      body: {
        "Encounter type": visit.name,
        "Subject ID": input.subject.ID,
        "Encounter date time": input.now.toISOString(),
        // The create is keyed on this, so a retry after a lost reply updates the same visit.
        "External ID": `breast-${input.formKey}-${input.screening.ID}`,
        observations,
      },
    };
  }
  // A partial update: Avni keeps every answer this body does not name (a question since removed
  // from the form, anything filled elsewhere) and the visit's schedule dates. A question of the
  // form that is now hidden or emptied is sent as null, which removes its saved answer — except a
  // Location, and a question whose rule failed, which are left as they are.
  for (const e of allElements(form)) {
    if (e.parentUuid || e.concept.name in observations || isLocation(e) || untouchable(e)) continue;
    if (view.statuses.get(statusKey(e.uuid))?.failed) continue;
    observations[e.concept.name] = null;
  }
  return {
    kind: "patch",
    uuid: existing.ID,
    body: { "Encounter type": visit.name, "Encounter date time": submitted ?? input.now.toISOString(), observations },
  };
}

function failure(err: unknown): string {
  const e = err as { isAxiosError?: boolean; response?: { status?: number; data?: unknown }; message?: string };
  if (e?.isAxiosError && !e.response) return "No connection. Your answers are kept; try again.";
  if (e?.response?.status === 401) {
    // The header's Sign out clears every draft; a reload goes to the sign-in form and keeps them.
    return "Your session has ended. Reload this page to sign in again; your answers are kept in this browser. Do not use Sign out, it clears them.";
  }
  if (e?.response?.status === 403) return "Your account is not allowed to save this form. Your answers are kept.";
  const data = e?.response?.data;
  const detail =
    typeof data === "string"
      ? data
      : ((data as { message?: string } | undefined)?.message ?? (data as { errorMessage?: string } | undefined)?.errorMessage);
  return `Avni did not save the form${detail ? `: ${detail}` : e?.message ? `: ${e.message}` : ""}. Your answers are kept; try again.`;
}

export async function submitClinicianForm(input: SubmitInput, deps: SubmitDeps): Promise<SubmitResult> {
  const submission = buildSubmission(input);
  try {
    // A create is keyed on the screening, so it would replace a submission made after this page
    // was opened (another tab, a colleague). Look first, and refuse, as the oral review does.
    if (submission.kind === "create" && (await deps.findSubmitted())) {
      return {
        ok: false,
        stale: true,
        message:
          "This form has been submitted for her since you opened this page, in another tab or by a colleague. Nothing was saved. Your answers are kept as a draft; the page now shows what is in Avni.",
      };
    }
    if (submission.kind === "create") await deps.create(submission.body);
    else await deps.patch(submission.uuid, submission.body);
  } catch (err) {
    return { ok: false, message: failure(err) };
  }
  deps.onSaved();
  const firstAssessment = input.formKey === "assessment" && !input.existing?.["Encounter date time"];
  if (!firstAssessment || input.openClinicianVisit) return { ok: true, warning: null };
  // As the form's visit-schedule rule does on the phone, in local time: due today, overdue after seven days.
  const earliest = startOfDay(input.now);
  try {
    await deps.schedule({
      encounterType: { name: BREAST_VISITS.clinician.name, uuid: BREAST_VISITS.clinician.uuid },
      subjectId: input.subject.ID,
      earliestVisitDateTime: earliest.toISOString(),
      maxVisitDateTime: endOfDay(addDays(earliest, 7)).toISOString(),
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
