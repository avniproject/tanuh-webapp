import { describe, expect, it } from "vitest";
import riskJson from "./__fixtures__/breast-cancer-risk-assessment-form.json";
import screeningJson from "./__fixtures__/breast-cancer-screening-questionnaire.json";
import { allElements, parseForm } from "./formDef";
import type { Answers } from "./answers";
import { isVisible, runFormRules, type Subject, type VisitDraft } from "./ruleRunner";

const risk = parseForm(riskJson);
const screening = parseForm(screeningJson);
const el = (name: string) => {
  const hit = allElements(risk).filter((e) => e.name === name);
  if (hit.length !== 1) throw new Error(`${name}: ${hit.length}`);
  return hit[0];
};
const screeningConcept = (name: string) => allElements(screening).find((e) => e.concept.name === name)!.concept;
const answerOf = (conceptName: string, answer: string) =>
  screeningConcept(conceptName).answers.find((a) => a.name === answer)!.uuid;

const draft: VisitDraft = { uuid: "draft", encounterType: "Breast Cancer Risk Assessment", encounterDateTime: new Date() };
const subject = (atScreening: Answers): Subject => ({
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
const menopause = (answer: string): Answers => ({
  [screeningConcept("PS Menopause status").uuid]: answerOf("PS Menopause status", answer),
});

describe("runFormRules on the Breast Cancer Risk Assessment form", () => {
  const cycles = el("Are your menstrual cycles regular?");

  it("shows a question whose rule reads the screening, when the screening says so", () => {
    const st = runFormRules(risk, {}, subject(menopause("No")), draft);
    expect(isVisible(st, cycles)).toBe(true);
  });

  it("hides it when the screening says otherwise, or there is no screening answer", () => {
    expect(isVisible(runFormRules(risk, {}, subject(menopause("Yes")), draft), cycles)).toBe(false);
    expect(isVisible(runFormRules(risk, {}, subject({}), draft), cycles)).toBe(false);
  });

  it("computes the read-only age from the date of birth", () => {
    const age = allElements(risk).find((e) => e.concept.name === "PS Age years")!;
    const st = runFormRules(risk, {}, subject({}), draft).get(age.uuid)!;
    expect(typeof st.value).toBe("number");
    expect(st.value as number).toBeGreaterThan(40);
  });

  it("leaves a question out when its rule throws, and still answers for the others", () => {
    const broken = {
      ...risk,
      pages: risk.pages.map((p) => ({
        ...p,
        elements: p.elements.map((e) => (e.uuid === cycles.uuid ? { ...e, rule: "({params}) => { throw new Error('boom'); }" } : e)),
      })),
    };
    const st = runFormRules(broken, {}, subject(menopause("No")), draft);
    expect(isVisible(st, cycles)).toBe(false);
    expect(st.size).toBeGreaterThan(50);
    expect(isVisible(st, allElements(risk).find((e) => !e.rule)!)).toBe(true);
  });
});
