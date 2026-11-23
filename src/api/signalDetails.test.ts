import { format, parseISO } from "date-fns";
import { describe, expect, it } from "vitest";
import { signalDetailsOf } from "./signalDetails";

const D = (observations: Record<string, unknown>) => signalDetailsOf({ observations }).ocshr;
const when = (iso: string) => format(parseISO(iso), "dd MMM yyyy, h:mm a");
const T = "2026-11-17T11:22:00Z";

describe("OCSHR status line, one per row", () => {
  it("failure row: error text and code", () =>
    expect(D({ "OCSHR Model Status": "REJECTED", "OCSHR Model Error": "Bad image", "OCSHR Model Error Code": "E1" })).toMatchObject({
      state: "unavailable",
      resultText: "Not available",
      statusLine: "Not scored: Bad image (E1)",
    }));
  it("scored row", () =>
    expect(D({ "OCSHR Model Result": "High Risk", "OCSHR Model Processed Time": T })).toMatchObject({
      state: "scored",
      resultText: "High Risk: Yes",
      statusLine: `Scored · ${when(T)}`,
    }));
  it("scored row, not high risk", () =>
    expect(D({ "OCSHR Model Result": "Not High Risk" })).toMatchObject({ resultText: "High Risk: No", statusLine: "Scored" }));
  it("QC fail row", () =>
    expect(D({ "QC status": "QC Fail", "OCSHR Call Made": "Yes" })).toMatchObject({
      state: "unavailable",
      resultText: "Not available",
      statusLine: "Not sent: failed the quality check",
    }));
  it("call made No row", () =>
    expect(D({ "OCSHR Call Made": "No" })).toMatchObject({
      state: "unavailable",
      resultText: "Not available",
      statusLine: "Not sent to the model",
    }));
  it("call made Yes row", () =>
    expect(D({ "OCSHR Call Made": "Yes" })).toMatchObject({ state: "pending", resultText: "Pending", statusLine: "Sent, not yet scored" }));
  it("call made empty row", () =>
    expect(D({})).toMatchObject({ state: "pending", resultText: "Pending", statusLine: "Not sent yet" }));
});

describe("OCSHR rules", () => {
  it("a failure wins over a stored result", () =>
    expect(D({ "OCSHR Model Result": "High Risk", "OCSHR Model Status": "FAILED" })).toMatchObject({
      resultText: "Not available",
      statusLine: "Not scored",
    }));
  it("only an error code reads Not scored (TIMEOUT) with a failed status", () =>
    expect(D({ "OCSHR Model Status": "FAILED", "OCSHR Model Error Code": "TIMEOUT" }).statusLine).toBe("Not scored (TIMEOUT)"));
  it("error text alone makes it Not scored", () =>
    expect(D({ "OCSHR Model Error": "Boom" }).statusLine).toBe("Not scored: Boom"));
  it("a lone error code is not a failure", () =>
    expect(D({ "OCSHR Model Status": "DELIVERED", "OCSHR Model Error Code": "TIMEOUT", "OCSHR Call Made": "Yes" })).toMatchObject({
      resultText: "Pending",
      statusLine: "Sent, not yet scored",
    }));
  it("status is trimmed and case-insensitive", () =>
    expect(D({ "OCSHR Model Status": " failed " }).statusLine).toBe("Not scored"));
  it("QC status is trimmed and case-insensitive", () =>
    expect(D({ "QC status": "qc fail" }).statusLine).toBe("Not sent: failed the quality check"));
  it("unknown status with a result gives the scored row", () =>
    expect(D({ "OCSHR Model Status": "QUEUED", "OCSHR Model Result": "Not High Risk" }).statusLine).toBe("Scored"));
  it("unknown status without a result falls to Call Made rows", () => {
    expect(D({ "OCSHR Model Status": "QUEUED", "OCSHR Call Made": "Yes" }).statusLine).toBe("Sent, not yet scored");
    expect(D({ "OCSHR Model Status": "QUEUED" }).statusLine).toBe("Not sent yet");
  });
  it("a stored Yes is not a result", () =>
    expect(D({ "OCSHR Model Result": "Yes", "OCSHR Call Made": "Yes" })).toMatchObject({ resultText: "Pending", statusLine: "Sent, not yet scored" }));
  it("an unreadable processed time reads Scored", () =>
    expect(D({ "OCSHR Model Result": "High Risk", "OCSHR Model Processed Time": "garbage" }).statusLine).toBe("Scored"));
});

describe("probability and version", () => {
  const p = (v: unknown) => D({ "OCSHR Model Result": "High Risk", "OCSHR Model Probability": v }).probability;
  it("shows up to four decimals, trailing zeros dropped, for numbers and numeric text", () => {
    expect(p(0.8214)).toBe("0.8214");
    expect(p(0.82)).toBe("0.82");
    expect(p(0.4999)).toBe("0.4999");
    expect(p(0.5)).toBe("0.5");
    expect(p(0)).toBe("0");
    expect(p(1)).toBe("1");
    expect(p("0.7312")).toBe("0.7312");
    expect(p(0.123456)).toBe("0.1235");
  });
  it("leaves out anything else", () => {
    for (const v of ["abc", 1.4, -0.1, undefined]) expect(p(v)).toBeUndefined();
  });
  it("passes the version through", () => expect(D({ "OCSHR Model Version": "v2.1" }).version).toBe("v2.1"));
});

describe("FLW, Edge and safety sample", () => {
  const all = (o: Record<string, unknown>) => signalDetailsOf({ observations: o });
  it("empty screening", () => {
    const d = all({});
    expect(d.flw).toEqual({ verdict: undefined, referralRaised: false });
    expect(d.edge.verdict).toBeUndefined();
    expect(d.edge.flagged).toBeUndefined();
    expect(d.ocshr.statusLine).toBe("Not sent yet");
    expect(d.safetySample).toBe(false);
  });
  it("Not suspicious maps to Non-Suspicious", () =>
    expect(all({ "ORAL SCREENING": [{ "Suspicious Lesion?": "No" }] }).flw.verdict).toBe("Non-Suspicious"));
  it("Suspicious stays", () =>
    expect(all({ "ORAL SCREENING": [{ "Suspicious Lesion?": "Yes" }] }).flw.verdict).toBe("Suspicious"));
  it("place of referral raises a referral", () => expect(all({ "Place of referral": "loc-1" }).flw.referralRaised).toBe(true));
  it("counts flagged images", () =>
    expect(
      all({ "Image-wise AI Assessment": [{ "AI Verdict": "Suspicious" }, { "AI Verdict": "Suspicious" }, { "AI Verdict": "Non-Suspicious" }] }).edge,
    ).toEqual({ verdict: "Suspicious", flagged: { suspicious: 2, of: 3 } }));
  const negative = (o: Record<string, unknown> = {}) => ({
    "ORAL SCREENING": [{ "Suspicious Lesion?": "No" }],
    "Egde AI Final Verdict": "Non-Suspicious",
    "OCSHR Model Result": "Not High Risk",
    "Random Sample ID": 0.01,
    ...o,
  });
  it("safety sample for an all-negative low id", () => expect(all(negative()).safetySample).toBe(true));
  it("not for 0.5", () => expect(all(negative({ "Random Sample ID": 0.5 })).safetySample).toBe(false));
  it("not when the model failed", () => expect(all(negative({ "OCSHR Model Status": "FAILED" })).safetySample).toBe(false));
});

describe("probability only on a scored card", () => {
  it("a failure row carries no probability but keeps the version", () => {
    const o = D({
      "OCSHR Model Result": "High Risk",
      "OCSHR Model Probability": 0.91,
      "OCSHR Model Version": "v2.1",
      "OCSHR Model Status": "FAILED",
    });
    expect(o.state).toBe("unavailable");
    expect(o.probability).toBeUndefined();
    expect(o.version).toBe("v2.1");
  });
  it("a pending row carries no probability", () =>
    expect(D({ "OCSHR Call Made": "Yes", "OCSHR Model Probability": 0.5 }).probability).toBeUndefined());
  it("a scored row keeps it", () =>
    expect(D({ "OCSHR Model Result": "High Risk", "OCSHR Model Probability": 0.91 }).probability).toBe("0.91"));
});
