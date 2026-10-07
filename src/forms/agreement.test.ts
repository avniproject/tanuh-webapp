import { describe, expect, it } from "vitest";
import { computeAgreement } from "./agreement";

describe("computeAgreement", () => {
  it.each([
    ["High Risk", "Suspicious", "High Risk", "Match"],
    ["High Risk", "Suspicious", "Low Risk", "Mismatch"],
    ["High Risk", "Suspicious", "Non Suspicious", "Mismatch"],
    ["Low-risk", "Suspicious", "Low Risk", "Match"],
    ["Low-risk", "Suspicious", "High Risk", "Mismatch"],
    ["Low-risk", "Non-Suspicious", "Non Suspicious", "Match"],
    ["Low-risk", "Suspicious", "Non Suspicious", "Mismatch"],
  ])("clinician %s / %s against the model's %s is %s", (risk, classification, model, expected) => {
    expect(computeAgreement(risk, classification, model)).toBe(expected);
  });
  it("is nothing without a model result", () => {
    expect(computeAgreement("High Risk", "Suspicious", undefined)).toBeNull();
  });
  it("is nothing without the clinician's risk or classification", () => {
    expect(computeAgreement(undefined, "Suspicious", "High Risk")).toBeNull();
    expect(computeAgreement("Low-risk", "", "Low Risk")).toBeNull();
  });
  it("is nothing for an answer outside the table", () => {
    expect(computeAgreement("Moderate", "Suspicious", "High Risk")).toBeNull();
    expect(computeAgreement("Low-risk", "Suspicious", "Unclear")).toBeNull();
  });
});
