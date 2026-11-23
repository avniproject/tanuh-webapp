import { describe, expect, it } from "vitest";
import riskJson from "./__fixtures__/breast-cancer-risk-assessment-form.json";
import screeningJson from "./__fixtures__/breast-cancer-screening-questionnaire.json";
import { rulesConfig } from "./avniLibs";
import type { Answers } from "./answers";
import { allElements, parseForm } from "./formDef";
import { evaluate, sectionProgress } from "./formState";
import { isVisible, type Subject, type VisitDraft } from "./ruleRunner";

// On UAT the Risk Assessment form was saved once in the App Designer, which replaces each rule's
// text with the one it generates from the declarative rule. This runs the form as it is there.
type Json = Record<string, unknown>;
const asSaved = (json: Json): Json => ({
  ...json,
  formElementGroups: (json.formElementGroups as Json[]).map((g) => ({
    ...g,
    formElements: (g.formElements as Json[]).map((e) =>
      Array.isArray(e.declarativeRule)
        ? { ...e, rule: rulesConfig.DeclarativeRuleHolder.fromResource(e.declarativeRule).generateViewFilterRule("encounter") }
        : e,
    ),
  })),
});
const risk = parseForm(asSaved(riskJson as unknown as Json));
const screening = parseForm(screeningJson);
const s = (name: string) => allElements(screening).find((e) => e.concept.name === name)!.concept;
const yes = (name: string, answer = "Yes") => s(name).answers.find((a) => a.name === answer)!.uuid;
const woman = (atScreening: Answers, screenedAt: Date): Subject => ({
  uuid: "woman",
  gender: "Female",
  dateOfBirth: "1961-01-01",
  earlier: [
    {
      uuid: "screening",
      encounterType: "Breast Cancer Screening",
      encounterDateTime: screenedAt.toISOString(),
      cancelDateTime: null,
      answers: atScreening,
      concepts: allElements(screening).map((e) => e.concept),
    },
  ],
});
const draft = (at: Date): VisitDraft => ({ uuid: "draft", encounterType: "Breast Cancer Risk Assessment", encounterDateTime: at });
const family = risk.pages.find((p) => p.name === "Family history")!;
const group = family.elements.find((e) => e.concept.name === "PS Relatives vital status")!;
const earlier = new Date("2026-11-23T05:00:00.000Z");
const later = new Date("2026-11-23T09:00:00.000Z");

describe("the Risk Assessment form as saved in the App Designer", () => {
  it("asks the family history questions when the screening recorded a family history of cancer", () => {
    const view = evaluate(risk, {}, woman({ [s("PS Family cancer history").uuid]: yes("PS Family cancer history") }, earlier), draft(later));
    expect(isVisible(view.statuses, group)).toBe(true);
    expect(sectionProgress(risk, family, view).notApplicable).toBe(false);
  });

  it("marks family history not applicable when the screening said No", () => {
    const view = evaluate(risk, {}, woman({ [s("PS Family cancer history").uuid]: yes("PS Family cancer history", "No") }, earlier), draft(later));
    expect(sectionProgress(risk, family, view).notApplicable).toBe(true);
  });

  it("no generated rule fails", () => {
    const view = evaluate(risk, {}, woman({ [s("PS Family cancer history").uuid]: yes("PS Family cancer history") }, earlier), draft(later));
    expect([...view.statuses.values()].filter((st) => st.failed)).toEqual([]);
  });

  it("does not read a screening dated after the visit being filled", () => {
    // Avni reads only visits before the one on screen. An assessment dated before its screening
    // (a backdated or wrongly dated visit) therefore sees no screening answers.
    const view = evaluate(risk, {}, woman({ [s("PS Family cancer history").uuid]: yes("PS Family cancer history") }, later), draft(earlier));
    expect(sectionProgress(risk, family, view).notApplicable).toBe(true);
  });
});
