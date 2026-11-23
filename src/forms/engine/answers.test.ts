import { describe, expect, it } from "vitest";
import riskJson from "./__fixtures__/breast-cancer-risk-assessment-form.json";
import { ConceptRegistry, answersFromApi } from "./answers";
import { allElements, parseForm } from "./formDef";

// A copy of the form in which one answer of "PS Diagnosed with diabetes" has since been retired in Avni.
const retire = (json: typeof riskJson, conceptName: string, answerName: string) =>
  JSON.parse(
    JSON.stringify(json, (_k, v) =>
      v && typeof v === "object" && v.name === conceptName && Array.isArray(v.answers)
        ? { ...v, answers: v.answers.map((a: { name: string }) => (a.name === answerName ? { ...a, voided: true } : a)) }
        : v,
    ),
  );
const form = parseForm(retire(riskJson, "PS Diagnosed with diabetes", "No"));
const registry = new ConceptRegistry().add(form);
const concept = (name: string) => allElements(form).find((e) => e.concept.name === name)!.concept;

describe("answersFromApi", () => {
  it("reads an answer whose option has since been retired, and does not offer it for new answers", () => {
    const diabetes = concept("PS Diagnosed with diabetes");
    const { answers, unmapped } = answersFromApi({ "PS Diagnosed with diabetes": "No" }, registry);
    const no = diabetes.answers.find((a) => a.name === "No")!;
    expect(no.voided).toBe(true);
    expect(answers[diabetes.uuid]).toBe(no.uuid);
    expect(unmapped.size).toBe(0);
  });

  it("marks a question whose stored answer it could not read in full, so a save never rewrites it", () => {
    const thyroid = concept("PS Thyroid conditions");
    const records = concept("PS Thyroid treatment records");
    const height = concept("PS Height cm");
    const { answers, unmapped } = answersFromApi(
      {
        "PS Thyroid conditions": [thyroid.answers[0].name, "An option this form never had"],
        "PS Thyroid treatment records": [{ "PS Thyroid treatment type": "Surgery", "A field since removed": "x" }],
        "PS Height cm": { phoneNumber: "9999999999", verified: false },
      },
      registry,
    );
    expect(unmapped).toEqual(new Set([thyroid.uuid, records.uuid, height.uuid]));
    expect(answers[thyroid.uuid]).toEqual([thyroid.answers[0].uuid]);
    expect(answers[height.uuid]).toBeUndefined();
  });

  it("marks a question group that is not stored as a list of records", () => {
    const records = concept("PS Thyroid treatment records");
    const { answers, unmapped } = answersFromApi({ "PS Thyroid treatment records": { "child-uuid": "answer-uuid" } }, registry);
    expect(unmapped.has(records.uuid)).toBe(true);
    expect(answers[records.uuid]).toBeUndefined();
  });

  it("reads everything else in full", () => {
    const records = concept("PS Thyroid treatment records");
    const type = concept("PS Thyroid treatment type");
    const { answers, unmapped } = answersFromApi(
      { "PS Height cm": 158, "PS Thyroid treatment records": [{ "PS Thyroid treatment type": type.answers[0].name }] },
      registry,
    );
    expect(unmapped.size).toBe(0);
    expect(answers[records.uuid]).toEqual([{ [type.uuid]: type.answers[0].uuid }]);
  });
});
