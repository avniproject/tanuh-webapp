import { describe, expect, it } from "vitest";
import riskJson from "./__fixtures__/breast-cancer-risk-assessment-form.json";
import screeningJson from "./__fixtures__/breast-cancer-screening-questionnaire.json";
import clinicianJson from "./__fixtures__/breast-clinician-assessment-form.json";
import { buildObservations, type Answers } from "./answers";
import { allElements, parseForm, type ElementDef } from "./formDef";
import { evaluate, missingMandatory, sectionProgress } from "./formState";
import { isVisible, type Subject, type VisitDraft } from "./ruleRunner";

const risk = parseForm(riskJson);
const screening = parseForm(screeningJson);
const clinician = parseForm(clinicianJson);
const byConcept = (name: string, form = risk): ElementDef => {
  const hit = allElements(form).filter((e) => e.concept.name === name);
  if (hit.length !== 1) throw new Error(`${name}: ${hit.length}`);
  return hit[0];
};
const answer = (e: ElementDef, name: string): string => e.concept.answers.find((a) => a.name === name)!.uuid;
const draft: VisitDraft = { uuid: "draft", encounterType: "Breast Cancer Risk Assessment", encounterDateTime: new Date() };
const woman = (atScreening: Answers = {}): Subject => ({
  uuid: "woman",
  gender: "Female",
  dateOfBirth: "1980-01-01",
  earlier: [
    {
      uuid: "screening",
      encounterType: "Breast Cancer Screening",
      encounterDateTime: new Date(Date.now() - 5 * 86400000).toISOString(),
      cancelDateTime: null,
      answers: atScreening,
      concepts: allElements(screening).map((e) => e.concept),
    },
  ],
});

describe("evaluate", () => {
  it("writes a value the form computes into the answers", () => {
    const age = byConcept("PS Age years");
    const view = evaluate(risk, {}, woman(), draft);
    expect(view.answers[age.concept.uuid]).toBeGreaterThan(40);
  });

  it("shows a follow-up question once its question is answered that way, in the same pass", () => {
    const ethnicity = byConcept("PS Ethnicity");
    const other = byConcept("PS Other ethnicity details");
    expect(isVisible(evaluate(risk, {}, woman(), draft).statuses, other)).toBe(false);
    const view = evaluate(risk, { [ethnicity.concept.uuid]: answer(ethnicity, "Other") }, woman(), draft);
    expect(isVisible(view.statuses, other)).toBe(true);
  });
});

describe("what is sent", () => {
  it("leaves out an answer typed into a question that a later answer hid", () => {
    const ethnicity = byConcept("PS Ethnicity");
    const other = byConcept("PS Other ethnicity details");
    const typed: Answers = {
      [ethnicity.concept.uuid]: ethnicity.concept.answers.find((a) => a.name !== "Other")!.uuid,
      [other.concept.uuid]: "typed before she changed her mind",
    };
    const view = evaluate(risk, typed, woman(), draft);
    const sent = buildObservations(risk, (e, row) => isVisible(view.statuses, e, row), view.answers);
    expect(sent).not.toHaveProperty("PS Other ethnicity details");
    expect(sent["PS Ethnicity"]).toBe(ethnicity.concept.answers.find((a) => a.name !== "Other")!.name);
  });

  it("sends coded answers by name and question-group rows as a list of records", () => {
    const records = byConcept("PS Thyroid treatment records");
    const type = byConcept("PS Thyroid treatment type");
    const at = byConcept("PS Age at thyroid treatment years");
    const answers: Answers = {
      [records.concept.uuid]: [{ [type.concept.uuid]: type.concept.answers[0].uuid, [at.concept.uuid]: 41 }],
    };
    const sent = buildObservations(risk, () => true, answers);
    expect(sent["PS Thyroid treatment records"]).toEqual([
      { "PS Thyroid treatment type": type.concept.answers[0].name, "PS Age at thyroid treatment years": 41 },
    ]);
  });
});

describe("missingMandatory", () => {
  it("names a visible mandatory question with no answer, and not a hidden one", () => {
    const view = evaluate(risk, {}, woman(), draft);
    const missing = missingMandatory(risk, view.statuses, view.answers).map((m) => m.element.concept.name);
    expect(missing).toContain("PS Height cm");
    expect(missing).not.toContain("PS Menstrual cycles regular"); // hidden: the screening has no menopause answer
    expect(missing).not.toContain("PS Age years"); // computed, not mandatory
  });

  it("is empty once every visible mandatory question is answered", () => {
    const classification = byConcept("PS Clinician risk classification", clinician);
    const notes = byConcept("PS Clinician case notes", clinician);
    const view = evaluate(
      clinician,
      { [classification.concept.uuid]: classification.concept.answers[0].uuid, [notes.concept.uuid]: "Seen." },
      woman(),
      { ...draft, encounterType: "Breast Clinician Assessment" },
    );
    expect(missingMandatory(clinician, view.statuses, view.answers)).toEqual([]);
  });

  it("asks for the mandatory fields of each row of a question group that has rows", () => {
    const history = byConcept("PS Family cancer history", screening);
    const relatives = byConcept("PS Relatives with cancer", screening);
    const relationship = byConcept("PS Relative relationship", screening);
    const answers: Answers = {
      [history.concept.uuid]: answer(history, "Yes"),
      [relatives.concept.uuid]: [{}, { [relationship.concept.uuid]: relationship.concept.answers[0].uuid }],
    };
    const view = evaluate(screening, answers, { ...woman(), earlier: [] }, { ...draft, encounterType: "Breast Cancer Screening" });
    const rows = missingMandatory(screening, view.statuses, view.answers)
      .filter((m) => m.element.uuid === relationship.uuid)
      .map((m) => m.row);
    expect(rows).toEqual([0]);
  });
});

describe("sectionProgress", () => {
  it("counts the visible mandatory questions of a section and how many are answered", () => {
    const page = risk.pages.find((p) => p.name === "General information")!;
    const height = byConcept("PS Height cm");
    const before = sectionProgress(risk, page, evaluate(risk, {}, woman(), draft));
    const after = sectionProgress(risk, page, evaluate(risk, { [height.concept.uuid]: 158 }, woman(), draft));
    expect(before).toMatchObject({ total: 2, done: 0, notApplicable: false });
    expect(after).toMatchObject({ total: 2, done: 1 });
  });

  it("marks a section with no visible question as not applicable", () => {
    const page = risk.pages.find((p) => p.name === "Fertility history")!;
    expect(sectionProgress(risk, page, evaluate(risk, {}, woman(), draft)).notApplicable).toBe(true);
  });
});
