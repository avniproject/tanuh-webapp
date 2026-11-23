import { describe, expect, it, vi } from "vitest";
import type { EncounterApiResponse, SubjectApiResponse } from "@/api/types";
import clinicianJson from "@/forms/engine/__fixtures__/breast-clinician-assessment-form.json";
import { allElements, parseForm } from "@/forms/engine/formDef";
import type { FormView } from "@/forms/engine/formState";
import { buildSubmission, submitClinicianForm, type SubmitDeps, type SubmitInput } from "./submit";

const form = parseForm(clinicianJson);
const [classification, notes] = allElements(form);
const view: FormView = {
  answers: { [classification.concept.uuid]: classification.concept.answers[0].uuid, [notes.concept.uuid]: "Seen today." },
  statuses: new Map(),
};
const enc = (over: Partial<EncounterApiResponse>): EncounterApiResponse => ({
  ID: "x",
  "Subject ID": "woman",
  "Subject external ID": null,
  "Subject type": "Patient",
  Voided: false,
  "External ID": null,
  "Encounter type": "Breast Clinician Assessment",
  "Encounter date time": null,
  "Earliest scheduled date": null,
  "Max scheduled date": null,
  "Cancel date time": null,
  observations: {},
  ...over,
});
const subject = { ID: "woman", observations: { "Patient ID": "P4001" } } as unknown as SubjectApiResponse;
const screening = enc({ ID: "scr-1", "Encounter type": "Breast Cancer Screening", "Encounter date time": "2026-11-20T05:00:00.000Z" });
const now = new Date("2026-11-23T08:00:00.000Z");
const input = (over: Partial<SubmitInput> = {}): SubmitInput => ({
  formKey: "clinician",
  form,
  view,
  subject,
  screening,
  existing: null,
  siblings: [],
  openClinicianVisit: false,
  now,
  ...over,
});

describe("buildSubmission", () => {
  it("creates a new visit on the woman, dated now, with its Encounter ID and answers by name", () => {
    const { uuid, body } = buildSubmission(input());
    expect(uuid).toBeNull();
    expect(body).toMatchObject({
      "Encounter type": "Breast Clinician Assessment",
      "Subject ID": "woman",
      "Encounter date time": now.toISOString(),
      "External ID": "breast-clinician-scr-1",
    });
    expect(body.observations).toEqual({
      "PS Clinician risk classification": classification.concept.answers[0].name,
      "PS Clinician case notes": "Seen today.",
      "Encounter ID": "P4001BCL001",
    });
  });

  it("completes a visit that was booked, keeping its dates and numbering after earlier ones", () => {
    const booked = enc({ ID: "booked", "Earliest scheduled date": "2026-11-22T00:00:00.000Z", "Max scheduled date": "2026-11-29T00:00:00.000Z" });
    const earlier = enc({ ID: "old", "Encounter date time": "2026-10-01T00:00:00.000Z", observations: { "Encounter ID": "P4001BCL001" } });
    const { uuid, body } = buildSubmission(input({ existing: booked, siblings: [earlier, booked] }));
    expect(uuid).toBe("booked");
    expect(body["Earliest scheduled date"]).toBe("2026-11-22T00:00:00.000Z");
    expect(body["Max scheduled date"]).toBe("2026-11-29T00:00:00.000Z");
    expect(body["Encounter date time"]).toBe(now.toISOString());
    expect(body).not.toHaveProperty("External ID");
    expect(body.observations["Encounter ID"]).toBe("P4001BCL002");
  });

  it("updates a submitted visit in place, keeping its date and its Encounter ID", () => {
    const done = enc({ ID: "done", "Encounter date time": "2026-11-21T09:00:00.000Z", observations: { "Encounter ID": "P4001BCL001" } });
    const { uuid, body } = buildSubmission(input({ existing: done, siblings: [done] }));
    expect(uuid).toBe("done");
    expect(body["Encounter date time"]).toBe("2026-11-21T09:00:00.000Z");
    expect(body.observations["Encounter ID"]).toBe("P4001BCL001");
  });

  it("writes no Encounter ID for a woman with no Patient ID", () => {
    const { body } = buildSubmission(input({ subject: { ID: "woman", observations: {} } as unknown as SubjectApiResponse }));
    expect(body.observations).not.toHaveProperty("Encounter ID");
  });
});

describe("submitClinicianForm", () => {
  const deps = (over: Partial<SubmitDeps> = {}): SubmitDeps => ({
    submit: vi.fn().mockResolvedValue(enc({ ID: "saved" })),
    schedule: vi.fn().mockResolvedValue(undefined),
    onSaved: vi.fn(),
    ...over,
  });

  it("saves, then clears the draft", async () => {
    const d = deps();
    const result = await submitClinicianForm(input(), d);
    expect(result).toEqual({ ok: true, warning: null });
    expect(d.onSaved).toHaveBeenCalledTimes(1);
    expect(d.schedule).not.toHaveBeenCalled();
  });

  it("keeps the draft and says why when the save fails, so the clinician can try again", async () => {
    const d = deps({ submit: vi.fn().mockRejectedValue(Object.assign(new Error("Network Error"), { isAxiosError: true })) });
    const result = await submitClinicianForm(input(), d);
    expect(result).toEqual({ ok: false, message: "No connection. Your answers are kept; try again." });
    expect(d.onSaved).not.toHaveBeenCalled();
  });

  it("tells a clinician whose session ended to sign in again", async () => {
    const error = Object.assign(new Error("401"), { isAxiosError: true, response: { status: 401, data: {} } });
    const result = await submitClinicianForm(input(), deps({ submit: vi.fn().mockRejectedValue(error) }));
    expect(result).toEqual({ ok: false, message: "Your session has ended. Sign in again; your answers are kept in this browser." });
  });

  it("books the Clinician Assessment after a new additional assessment, unless one is already open", async () => {
    const d = deps();
    await submitClinicianForm(input({ formKey: "assessment" }), d);
    expect(d.schedule).toHaveBeenCalledWith({
      encounterType: { name: "Breast Clinician Assessment", uuid: "41c01d89-08b3-5db7-8274-01cf06018a39" },
      subjectId: "woman",
      earliestVisitDateTime: "2026-11-23T00:00:00.000Z",
      maxVisitDateTime: "2026-11-30T23:59:59.999Z",
    });
    const open = deps();
    await submitClinicianForm(input({ formKey: "assessment", openClinicianVisit: true }), open);
    expect(open.schedule).not.toHaveBeenCalled();
  });

  it("still counts the form as saved when only the booking fails, and says so", async () => {
    const d = deps({ schedule: vi.fn().mockRejectedValue(new Error("outside catchment")) });
    const result = await submitClinicianForm(input({ formKey: "assessment" }), d);
    expect(result).toEqual({
      ok: true,
      warning: "Saved. The Clinician Assessment visit could not be booked in Avni (outside catchment); it can still be filled here.",
    });
    expect(d.onSaved).toHaveBeenCalled();
  });
});
