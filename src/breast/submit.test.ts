import { addDays, endOfDay, startOfDay } from "date-fns";
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
  placeUuids: new Set<string>(),
  loaded: { answers: {}, unmapped: new Set<string>() },
  now,
  ...over,
});

describe("buildSubmission", () => {
  it("creates a new visit on the woman, dated now, with its Encounter ID and answers by name", () => {
    const sub = buildSubmission(input());
    expect(sub.kind).toBe("create");
    expect(sub.body).toMatchObject({
      "Encounter type": "Breast Clinician Assessment",
      "Subject ID": "woman",
      "Encounter date time": now.toISOString(),
      "External ID": "breast-clinician-scr-1",
    });
    expect(sub.body.observations).toEqual({
      "PS Clinician risk classification": classification.concept.answers[0].name,
      "PS Clinician case notes": "Seen today.",
      "Encounter ID": "P4001BCL001",
    });
  });

  it("completes a visit that was booked as a partial update: its dates are left alone, it is numbered after earlier ones", () => {
    const booked = enc({ ID: "booked", "Earliest scheduled date": "2026-11-22T00:00:00.000Z", "Max scheduled date": "2026-11-29T00:00:00.000Z" });
    const earlier = enc({ ID: "old", "Encounter date time": "2026-10-01T00:00:00.000Z", observations: { "Encounter ID": "P4001BCL001" } });
    const sub = buildSubmission(input({ existing: booked, siblings: [earlier, booked] }));
    expect(sub).toMatchObject({ kind: "patch", uuid: "booked" });
    expect(sub.body).not.toHaveProperty("Earliest scheduled date");
    expect(sub.body).not.toHaveProperty("Max scheduled date");
    expect(sub.body).not.toHaveProperty("External ID");
    expect(sub.body["Encounter date time"]).toBe(now.toISOString());
    expect(sub.body.observations["Encounter ID"]).toBe("P4001BCL002");
  });

  it("updates a submitted visit in place, keeping its date and its Encounter ID", () => {
    const done = enc({ ID: "done", "Encounter date time": "2026-11-21T09:00:00.000Z", observations: { "Encounter ID": "P4001BCL001" } });
    const sub = buildSubmission(input({ existing: done, siblings: [done] }));
    expect(sub).toMatchObject({ kind: "patch", uuid: "done" });
    expect(sub.body["Encounter date time"]).toBe("2026-11-21T09:00:00.000Z");
    expect(sub.body.observations["Encounter ID"]).toBe("P4001BCL001");
  });

  it("on an update, clears a question the clinician emptied and leaves alone anything the form does not list", () => {
    const done = enc({
      ID: "done",
      "Encounter date time": "2026-11-21T09:00:00.000Z",
      observations: { "PS Clinician case notes": "Old notes", "A question since removed from the form": "kept in Avni" },
    });
    const emptied: FormView = { answers: { [classification.concept.uuid]: classification.concept.answers[0].uuid }, statuses: new Map() };
    const { body } = buildSubmission(input({ existing: done, siblings: [done], view: emptied }));
    expect(body.observations["PS Clinician case notes"]).toBeNull();
    expect(body.observations).not.toHaveProperty("A question since removed from the form");
  });

  it("on an update, does not clear the saved answer of a question whose rule failed", () => {
    const done = enc({ ID: "done", "Encounter date time": "2026-11-21T09:00:00.000Z", observations: { "PS Clinician case notes": "Old notes" } });
    const failed: FormView = {
      answers: { [classification.concept.uuid]: classification.concept.answers[0].uuid },
      statuses: new Map([[notes.uuid, { visible: false, value: null, hiddenAnswers: [], errors: [], failed: true }]]),
    };
    const { body } = buildSubmission(input({ existing: done, siblings: [done], view: failed }));
    expect(body.observations).not.toHaveProperty("PS Clinician case notes");
  });

  it("on an update, leaves alone a question whose saved answer the portal could not read in full, unless she changed it", () => {
    const done = enc({ ID: "done", "Encounter date time": "2026-11-21T09:00:00.000Z" });
    const loaded = { answers: { [notes.concept.uuid]: "Seen today." }, unmapped: new Set([notes.concept.uuid, classification.concept.uuid]) };
    const untouched = buildSubmission(input({ existing: done, siblings: [done], loaded, view: { answers: { [notes.concept.uuid]: "Seen today." }, statuses: new Map() } }));
    expect(untouched.body.observations).not.toHaveProperty("PS Clinician case notes");
    expect(untouched.body.observations).not.toHaveProperty("PS Clinician risk classification");
    const changed = buildSubmission(input({ existing: done, siblings: [done], loaded, view: { answers: { [notes.concept.uuid]: "Seen again." }, statuses: new Map() } }));
    expect(changed.body.observations["PS Clinician case notes"]).toBe("Seen again.");
  });

  it("sends a hospital only as one of the listed places, never as the name Avni displayed", () => {
    const place = { ...notes, concept: { ...notes.concept, uuid: "loc", name: "PS Institution", dataType: "Location" }, uuid: "loc-el", mandatory: false };
    const withPlace = { ...form, pages: [{ ...form.pages[0], elements: [...form.pages[0].elements, place] }] };
    const answers = { ...view.answers };
    const done = enc({ ID: "done", "Encounter date time": "2026-11-21T09:00:00.000Z" });
    const shown = buildSubmission(input({ form: withPlace, existing: done, view: { answers: { ...answers, loc: "Devanahalli MC" }, statuses: new Map() } }));
    expect(shown.body.observations).not.toHaveProperty("PS Institution");
    const picked = buildSubmission(
      input({ form: withPlace, existing: done, placeUuids: new Set(["h1"]), view: { answers: { ...answers, loc: "h1" }, statuses: new Map() } }),
    );
    expect(picked.body.observations["PS Institution"]).toBe("h1");
  });

  it("writes no Encounter ID for a woman with no Patient ID", () => {
    const { body } = buildSubmission(input({ subject: { ID: "woman", observations: {} } as unknown as SubjectApiResponse }));
    expect(body.observations).not.toHaveProperty("Encounter ID");
  });
});

describe("submitClinicianForm", () => {
  const deps = (over: Partial<SubmitDeps> = {}): SubmitDeps => ({
    create: vi.fn().mockResolvedValue(enc({ ID: "saved" })),
    patch: vi.fn().mockResolvedValue(enc({ ID: "saved" })),
    findSubmitted: vi.fn().mockResolvedValue(null),
    schedule: vi.fn().mockResolvedValue(undefined),
    onSaved: vi.fn(),
    ...over,
  });

  it("creates a new visit, then clears the draft", async () => {
    const d = deps();
    const result = await submitClinicianForm(input(), d);
    expect(result).toEqual({ ok: true, warning: null });
    expect(d.create).toHaveBeenCalledTimes(1);
    expect(d.patch).not.toHaveBeenCalled();
    expect(d.onSaved).toHaveBeenCalledTimes(1);
    expect(d.schedule).not.toHaveBeenCalled();
  });

  it("refuses to create over a form someone has submitted since the page was opened", async () => {
    const d = deps({ findSubmitted: vi.fn().mockResolvedValue(enc({ ID: "theirs", "Encounter date time": "2026-11-22T00:00:00.000Z" })) });
    const result = await submitClinicianForm(input(), d);
    expect(result).toEqual({
      ok: false,
      stale: true,
      message: "This form has been submitted for her since you opened this page, in another tab or by a colleague. Nothing was saved. Your answers are kept as a draft; the page now shows what is in Avni.",
    });
    expect(d.create).not.toHaveBeenCalled();
    expect(d.onSaved).not.toHaveBeenCalled();
  });

  it("updates an existing visit through the partial update, never the full replace", async () => {
    const d = deps();
    await submitClinicianForm(input({ existing: enc({ ID: "done", "Encounter date time": "2026-11-21T09:00:00.000Z" }) }), d);
    expect(d.patch).toHaveBeenCalledWith("done", expect.objectContaining({ "Encounter type": "Breast Clinician Assessment" }));
    expect(d.create).not.toHaveBeenCalled();
  });

  it("keeps the draft and says why when the save fails, so the clinician can try again", async () => {
    const d = deps({ create: vi.fn().mockRejectedValue(Object.assign(new Error("Network Error"), { isAxiosError: true })) });
    const result = await submitClinicianForm(input(), d);
    expect(result).toEqual({ ok: false, message: "No connection. Your answers are kept; try again." });
    expect(d.onSaved).not.toHaveBeenCalled();
  });

  it("tells a clinician whose session ended to reload, which keeps the draft, and not to sign out, which clears it", async () => {
    const error = Object.assign(new Error("401"), { isAxiosError: true, response: { status: 401, data: {} } });
    const result = await submitClinicianForm(input(), deps({ create: vi.fn().mockRejectedValue(error) }));
    expect(result).toEqual({
      ok: false,
      message: "Your session has ended. Reload this page to sign in again; your answers are kept in this browser. Do not use Sign out, it clears them.",
    });
  });

  it("books the Clinician Assessment after a new additional assessment, due today and overdue after seven days, in local time", async () => {
    const d = deps();
    await submitClinicianForm(input({ formKey: "assessment" }), d);
    expect(d.schedule).toHaveBeenCalledWith({
      encounterType: { name: "Breast Clinician Assessment", uuid: "41c01d89-08b3-5db7-8274-01cf06018a39" },
      subjectId: "woman",
      earliestVisitDateTime: startOfDay(now).toISOString(),
      maxVisitDateTime: endOfDay(addDays(startOfDay(now), 7)).toISOString(),
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
