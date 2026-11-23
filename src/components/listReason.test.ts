import { describe, expect, it } from "vitest";
import { trimForCache } from "@/api/encounters";
import type { EncounterApiResponse } from "@/api/types";
import { OCSHR_REASON_BADGE, listReason } from "./listReason";

const screening = (observations: Record<string, unknown>) => ({ observations });

describe("listReason, the pending list's Reason and Status words", () => {
  it("passes a review group through, waiting for review", () => {
    expect(listReason("FLW marked", screening({}))).toEqual({ reason: "FLW marked", waitingFor: "review" });
    expect(listReason("Safety sample", screening({}))).toEqual({ reason: "Safety sample", waitingFor: "review" });
  });

  it("leaves a row with no reason with none, waiting for review", () => {
    expect(listReason(undefined, undefined)).toEqual({ reason: undefined, waitingFor: "review" });
  });

  it("keeps OCSHR pending, waiting for the result, while the model may still score the case", () => {
    for (const obs of [{}, { "OCSHR Call Made": "Yes" }, { "OCSHR Model Status": "QUEUED" }])
      expect(listReason("OCSHR pending", screening(obs))).toEqual({ reason: "OCSHR pending", waitingFor: "ocshr" });
  });

  it("reads OCSHR not scored, with No OCSHR result, when the model will never score the case", () => {
    const never = [
      { "QC status": "QC Fail" },
      { "OCSHR Call Made": "No" },
      { "OCSHR Model Status": "REJECTED" },
      { "OCSHR Model Status": "FAILED" },
      { "OCSHR Model Error": "Bad image" },
    ];
    for (const obs of never)
      expect(listReason("OCSHR pending", screening(obs))).toEqual({ reason: "OCSHR not scored", waitingFor: "no-ocshr" });
  });

  it("keeps OCSHR pending for a row whose screening is not known", () => {
    expect(listReason("OCSHR pending", undefined)).toEqual({ reason: "OCSHR pending", waitingFor: "ocshr" });
  });

  it("tells never from pending on the list's stored copy of a screening", () => {
    const stored = (obs: Record<string, unknown>) =>
      trimForCache({
        ID: "s1",
        "Subject ID": "p1",
        "Encounter type": "Oral Screening",
        Voided: false,
        "Encounter date time": "2026-11-20T10:00:00.000Z",
        observations: { "Egde AI Final Verdict": "Suspicious", ...obs },
      } as unknown as EncounterApiResponse);
    expect(listReason("OCSHR pending", stored({ "OCSHR Call Made": "No" })).reason).toBe("OCSHR not scored");
    expect(listReason("OCSHR pending", stored({ "QC status": "QC Fail" })).reason).toBe("OCSHR not scored");
    expect(listReason("OCSHR pending", stored({ "OCSHR Model Status": "FAILED" })).reason).toBe("OCSHR not scored");
    expect(listReason("OCSHR pending", stored({ "OCSHR Model Error": "Bad image" })).reason).toBe("OCSHR not scored");
    expect(listReason("OCSHR pending", stored({ "OCSHR Call Made": "Yes" })).reason).toBe("OCSHR pending");
  });
});

describe("OCSHR_REASON_BADGE, the Reason pill for a case with no OCSHR result", () => {
  it("keeps the hourglass and its test id for a pending case", () =>
    expect(OCSHR_REASON_BADGE["OCSHR pending"]).toEqual({ testId: "ocshr-pending-badge", icon: "hourglass" }));
  it("gives a never-scored case the no-result mark and its own test id", () =>
    expect(OCSHR_REASON_BADGE["OCSHR not scored"]).toEqual({ testId: "ocshr-not-scored-badge", icon: "no-result" }));
});
