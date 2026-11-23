import { describe, expect, it } from "vitest";
import screeningJson from "@/forms/engine/__fixtures__/breast-cancer-screening-questionnaire.json";
import { ConceptRegistry, answersFromApi } from "@/forms/engine/answers";
import { parseForm } from "@/forms/engine/formDef";
import { answeredSections } from "./answered";

const form = parseForm(screeningJson);
const registry = new ConceptRegistry().add(form);
const observations = {
  "PS Any breast symptoms": "Yes",
  "PS Current breast symptoms": ["Lump in the breast", "Nipple discharge"].filter((n) =>
    registry.name("PS Current breast symptoms")!.answers.some((a) => a.name === n),
  ),
  "PS Height cm": 158,
  "PS Family cancer history": "Yes",
  "PS Relatives with cancer": [
    { "PS Relative relationship": "Mother", "PS Relative cancer types": ["Breast cancer"], "PS Relative age at diagnosis years": 52 },
  ],
  "PS Risk Class": "HIGH RISK",
  "Encounter ID": "P4001BCS001",
  "A question this form does not have": "ignored",
};

describe("answeredSections", () => {
  const sections = answeredSections(form, answersFromApi(observations, registry));

  it("keeps the form's section order and leaves out sections with no answer", () => {
    const order = form.pages.map((p) => p.name);
    const names = sections.map((s) => s.name);
    expect(names).toEqual(order.filter((n) => names.includes(n)));
    expect(names).toContain("Symptoms");
    expect(names).not.toContain("Lifestyle history");
  });

  it("shows each answered question once, under its own section, in Avni's wording", () => {
    const symptoms = sections.find((s) => s.name === "Symptoms")!;
    expect(symptoms.rows[0]).toMatchObject({ element: { name: "Any Breast related symptoms?" }, text: "Yes" });
    const all = sections.flatMap((s) => s.rows.map((r) => r.element.uuid));
    expect(new Set(all).size).toBe(all.length);
  });

  it("shows a number with its unit and a repeatable record in full", () => {
    const flat = sections.flatMap((s) => s.rows);
    const relatives = flat.find((r) => r.element.concept.name === "PS Relatives with cancer")!;
    expect("records" in relatives && relatives.records[0].map((f) => f.text)).toEqual(["Mother", "Breast cancer", "52"]);
    expect(flat.find((r) => r.element.concept.name === "PS Height cm")).toMatchObject({ text: expect.stringMatching(/^158/) });
  });

  it("can leave named answers to another panel", () => {
    const without = answeredSections(form, answersFromApi(observations, registry), new Set(["PS Risk Class"]));
    expect(without.flatMap((s) => s.rows).some((r) => r.element.concept.name === "PS Risk Class")).toBe(false);
  });
});
