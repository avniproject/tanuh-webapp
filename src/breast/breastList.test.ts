import { describe, expect, it } from "vitest";
import type { EncounterApiResponse } from "@/api/types";
import { buildBreastCases, filterCases, pendingCount } from "./breastList";

let n = 0;
const visit = (
  type: string,
  subject: string,
  daysAgo: number | null,
  observations: Record<string, unknown> = {},
  extra: Partial<EncounterApiResponse> = {},
): EncounterApiResponse => ({
  ID: `enc-${++n}`,
  "Subject ID": subject,
  "Subject external ID": null,
  "Subject type": "Patient",
  Voided: false,
  "External ID": null,
  "Encounter type": type,
  "Encounter date time": daysAgo === null ? null : new Date(Date.UTC(2026, 10, 23) - daysAgo * 86400000).toISOString(),
  "Earliest scheduled date": null,
  "Max scheduled date": null,
  "Cancel date time": null,
  observations,
  ...extra,
});
const referred = (extra: Record<string, unknown> = {}) => ({
  "PS Refer for breast care": "Yes",
  "PS Any breast symptoms": "No",
  "PS Risk Class": "LOW RISK",
  "PS Age years": 43,
  "Encounter ID": "P4001BCS001",
  ...extra,
});
const screening = (subject: string, daysAgo: number | null, obs: Record<string, unknown> = referred()) =>
  visit("Breast Cancer Screening", subject, daysAgo, obs);
const none = new Set<string>();
const build = (s: EncounterApiResponse[], r: EncounterApiResponse[] = [], c: EncounterApiResponse[] = [], drafts = none) =>
  buildBreastCases(s, r, c, drafts);

describe("buildBreastCases", () => {
  it("lists a referred woman with her id, age, risk and both forms not started", () => {
    const s = screening("w1", 5);
    expect(build([s])).toEqual([
      {
        screeningUuid: s.ID,
        subjectUuid: "w1",
        subjectId: "P4001",
        screenedOn: s["Encounter date time"],
        age: 43,
        risk: "LOW RISK",
        hospital: null,
        reason: "FLW decision",
        assessment: "not_started",
        clinician: "not_started",
      },
    ]);
  });

  it("leaves out a woman who was not referred, a screening not yet done, and a voided one", () => {
    const cases = build([
      screening("w1", 5, referred({ "PS Refer for breast care": "No" })),
      screening("w2", null),
      visit("Breast Cancer Screening", "w3", 2, referred(), { Voided: true }),
    ]);
    expect(cases).toEqual([]);
  });

  it("shows only the newest referring screening of a woman screened twice", () => {
    const old = screening("w1", 40);
    const recent = screening("w1", 3, referred({ "Encounter ID": "P4001BCS002", "PS Risk Class": "HIGH RISK" }));
    const cases = build([old, recent]);
    expect(cases.map((c) => c.screeningUuid)).toEqual([recent.ID]);
    expect(cases[0].risk).toBe("HIGH RISK");
  });

  it("does not count a form filled before that screening as done", () => {
    const s = screening("w1", 3);
    const before = visit("Breast Cancer Risk Assessment", "w1", 30);
    expect(build([s], [before])[0].assessment).toBe("not_started");
  });

  it("counts a form completed after the screening as submitted, and one only booked as not started", () => {
    const s = screening("w1", 10);
    const done = visit("Breast Cancer Risk Assessment", "w1", 2);
    const booked = visit("Breast Clinician Assessment", "w1", null, {}, { "Earliest scheduled date": "2026-11-21T00:00:00Z" });
    const c = build([s], [done], [booked])[0];
    expect([c.assessment, c.clinician]).toEqual(["submitted", "not_started"]);
  });

  it("shows a draft kept in this browser, until the form is submitted", () => {
    const s = screening("w1", 10);
    const drafts = new Set([`${s.ID}|assessment`, `${s.ID}|clinician`]);
    const done = visit("Breast Cancer Risk Assessment", "w1", 2);
    const c = build([s], [done], [], drafts)[0];
    expect([c.assessment, c.clinician]).toEqual(["submitted", "draft"]);
  });

  it("names the reason: a symptom first, then the model, else the field worker's decision", () => {
    const reason = (obs: Record<string, unknown>) => build([screening("w", 1, referred(obs))])[0].reason;
    expect(reason({ "PS Any breast symptoms": "Yes", "PS Risk Class": "HIGH RISK" })).toBe("Red-flag symptom");
    expect(reason({ "PS Risk Class": "HIGH RISK" })).toBe("AI high risk");
    expect(reason({})).toBe("FLW decision");
  });

  it("reads the hospital from the picker, else the typed name", () => {
    const hospital = (obs: Record<string, unknown>) => build([screening("w", 1, referred(obs))])[0].hospital;
    expect(hospital({ "PS Breast referral facility": { District: "Bengaluru Rural", "Taluka Hospital": "Devanahalli TH" } })).toBe(
      "Devanahalli TH",
    );
    expect(hospital({ "PS Breast referral other facility": "City Clinic" })).toBe("City Clinic");
    expect(hospital({})).toBeNull();
  });

  it("falls back to the start of the subject uuid when the screening carries no Encounter ID", () => {
    const s = screening("0f3c9a1e-aaaa-bbbb-cccc-000000000000", 1, referred({ "Encounter ID": undefined }));
    expect(build([s])[0].subjectId).toBe("0f3c9a1e");
  });

  it("puts the newest screening first", () => {
    const a = screening("a", 9);
    const b = screening("b", 1);
    expect(build([a, b]).map((c) => c.subjectUuid)).toEqual(["b", "a"]);
  });
});

describe("pendingCount and filterCases", () => {
  const s1 = screening("w1", 5);
  const s2 = screening("w2", 4, referred({ "Encounter ID": "P4002BCS001" }));
  const cases = build(
    [s1, s2],
    [visit("Breast Cancer Risk Assessment", "w2", 1)],
    [visit("Breast Clinician Assessment", "w2", 1)],
  );

  it("counts a woman as waiting until both forms are submitted", () => {
    expect(pendingCount(cases)).toBe(1);
  });
  it("filters by waiting or assessed", () => {
    expect(filterCases(cases, "awaiting", "").map((c) => c.subjectUuid)).toEqual(["w1"]);
    expect(filterCases(cases, "assessed", "").map((c) => c.subjectUuid)).toEqual(["w2"]);
    expect(filterCases(cases, "all", "")).toHaveLength(2);
  });
  it("searches by subject id or hospital, ignoring case", () => {
    expect(filterCases(cases, "all", "p4002").map((c) => c.subjectUuid)).toEqual(["w2"]);
    expect(filterCases(cases, "all", "nowhere")).toEqual([]);
  });
});
