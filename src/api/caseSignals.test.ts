import { describe, expect, it } from "vitest";
import { classify, deriveEdgeVerdict, deriveFlwPositive, isReady, signalsOf, type CaseSignals } from "./caseSignals";

const S = (o: Partial<CaseSignals>): CaseSignals => ({ flwPositive: false, ...o });

describe("classify", () => {
  it("worker suspicious goes to FLW marked whatever the models say", () => {
    expect(classify(S({ flwPositive: true, edge: "Non-Suspicious", ocshr: "Not High Risk" }))).toEqual({
      group: "FLW marked",
      ocshrPending: false,
    });
  });
  it("edge suspicious, worker not, goes to AI marked", () =>
    expect(classify(S({ edge: "Suspicious", ocshr: "Not High Risk" })).group).toBe("AI marked"));
  it("OCSHR High Risk alone goes to AI marked", () =>
    expect(classify(S({ edge: "Non-Suspicious", ocshr: "High Risk" })).group).toBe("AI marked"));
  it("all negative and RSI below 0.05 is a safety sample", () => {
    for (const r of [0, 0.0499])
      expect(classify(S({ edge: "Non-Suspicious", ocshr: "Not High Risk", randomSampleId: r })).group).toBe("Safety sample");
  });
  it("all negative at or above 0.05, or without RSI, is excluded", () => {
    for (const r of [0.05, 0.5, 1, undefined, -0.01])
      expect(classify(S({ edge: "Non-Suspicious", ocshr: "Not High Risk", randomSampleId: r })).group).toBeUndefined();
  });
  it("an unknown edge verdict never makes a safety sample", () =>
    expect(classify(S({ ocshr: "Not High Risk", randomSampleId: 0.01 })).group).toBeUndefined());
  it("a missing OCSHR result is pending, never Not High Risk", () => {
    expect(classify(S({ flwPositive: true }))).toEqual({ group: "FLW marked", ocshrPending: true });
    expect(isReady(classify(S({ flwPositive: true })))).toBe(false);
    expect(classify(S({ edge: "Non-Suspicious", randomSampleId: 0.01 }))).toEqual({ group: undefined, ocshrPending: true });
  });
  it("a grouped case with OCSHR present is ready", () =>
    expect(isReady(classify(S({ edge: "Suspicious", ocshr: "Not High Risk" })))).toBe(true));
});

const photoRow = { "Oral Image": "https://s3/x.jpg" };

describe("deriveFlwPositive", () => {
  it("a Suspicious Lesion? Yes row is positive", () =>
    expect(deriveFlwPositive({ "ORAL SCREENING": [{ ...photoRow, "Suspicious Lesion?": "Yes" }] })).toBe(true));
  it("a referral with the mouth open is positive", () =>
    expect(deriveFlwPositive({ "Place of referral": "loc-1", "Able to Open Mouth?": "Yes" })).toBe(true));
  it("a referral with the mouth closed and no photo is not positive", () =>
    expect(deriveFlwPositive({ "Place of referral": "loc-1", "Able to Open Mouth?": "No" })).toBe(false));
  it("a referral with the mouth closed but a photo is positive", () =>
    expect(
      deriveFlwPositive({
        "Place of referral": "loc-1",
        "Able to Open Mouth?": "No",
        "Take photos of all lesions and 1 photo without lesion": [photoRow],
      }),
    ).toBe(true));
  it("nothing is not positive", () => expect(deriveFlwPositive({})).toBe(false));
});

describe("deriveEdgeVerdict", () => {
  const rows = (...v: string[]) => ({ "Image-wise AI Assessment": v.map((x) => ({ "AI Verdict": x })) });
  it("the concept wins over the rows", () =>
    expect(deriveEdgeVerdict({ "Egde AI Final Verdict": "Non-Suspicious", ...rows("Suspicious") })).toBe("Non-Suspicious"));
  it("reads the correctly spelled legacy name", () =>
    expect(deriveEdgeVerdict({ "Edge AI Final Verdict": "Suspicious" })).toBe("Suspicious"));
  it("an empty array concept falls back to the rows", () =>
    expect(deriveEdgeVerdict({ "Egde AI Final Verdict": [], ...rows("Suspicious") })).toBe("Suspicious"));
  it("any Suspicious row wins", () => expect(deriveEdgeVerdict(rows("Non-Suspicious", "Suspicious"))).toBe("Suspicious"));
  it("only Non-Suspicious rows give Non-Suspicious", () =>
    expect(deriveEdgeVerdict(rows("Non-Suspicious"))).toBe("Non-Suspicious"));
  it("no rows is undefined", () => expect(deriveEdgeVerdict({})).toBeUndefined());
});

describe("signalsOf", () => {
  it("reads Random Sample ID from a number and from a string", () => {
    expect(signalsOf({ observations: { "Random Sample ID": 0.03 } }).randomSampleId).toBe(0.03);
    expect(signalsOf({ observations: { "Random Sample ID": "0.03" } }).randomSampleId).toBe(0.03);
  });
  it("reads the OCSHR result", () =>
    expect(signalsOf({ observations: { "OCSHR Model Result": "High Risk" } }).ocshr).toBe("High Risk"));
  it("a cached null edge verdict is unknown and does not read the rows", () =>
    expect(
      signalsOf({ edgeVerdict: null, observations: { "Image-wise AI Assessment": [{ "AI Verdict": "Suspicious" }] } }).edge,
    ).toBeUndefined());
  it("a cached flwPositive is used over the observations", () =>
    expect(signalsOf({ flwPositive: false, observations: { "Place of referral": "x" } }).flwPositive).toBe(false));
});
