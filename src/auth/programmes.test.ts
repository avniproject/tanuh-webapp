import { describe, expect, it } from "vitest";
import type { MeResponse } from "./authContext";
import { allocatedProgrammes, landingPath, programmeOfPath } from "./programmes";

const me = (...groups: Array<string | [string, boolean]>): MeResponse => ({
  userUUID: "u",
  username: "u@tanuh_uat",
  name: "U",
  myUserGroups: groups.map((g, i) => {
    const [groupName, voided] = typeof g === "string" ? [g, false] : g;
    return { uuid: `m${i}`, groupUuid: `g${i}`, groupName, voided };
  }),
});

describe("allocatedProgrammes", () => {
  it("gives a Physician the oral programme only", () => {
    expect(allocatedProgrammes(me("Physician", "Everyone"))).toEqual(["oral"]);
  });
  it("gives a Breast Cancer Clinician the breast programme only", () => {
    expect(allocatedProgrammes(me("Breast Cancer Clinician", "Everyone"))).toEqual(["breast"]);
  });
  it("gives both, oral first, to a member of both groups", () => {
    expect(allocatedProgrammes(me("Breast Cancer Clinician", "Physician"))).toEqual(["oral", "breast"]);
  });
  it("gives nothing to a member of neither group, or to no groups at all", () => {
    expect(allocatedProgrammes(me("Everyone", "CHO"))).toEqual([]);
    expect(allocatedProgrammes({ userUUID: "u", username: "u", name: "U" })).toEqual([]);
  });
  it("ignores a membership that has been removed", () => {
    expect(allocatedProgrammes(me(["Breast Cancer Clinician", true], "Physician"))).toEqual(["oral"]);
  });
});

describe("landingPath", () => {
  it("opens the first allocated programme", () => {
    expect(landingPath(["oral", "breast"])).toBe("/pending");
    expect(landingPath(["breast"])).toBe("/breast");
  });
  it("opens the no-programme page when nothing is allocated", () => {
    expect(landingPath([])).toBe("/no-programme");
  });
});

describe("programmeOfPath", () => {
  it("places each clinician screen in its programme", () => {
    expect(programmeOfPath("/pending")).toBe("oral");
    expect(programmeOfPath("/completed")).toBe("oral");
    expect(programmeOfPath("/review/abc")).toBe("oral");
    expect(programmeOfPath("/case/abc")).toBe("oral");
    expect(programmeOfPath("/breast")).toBe("breast");
    expect(programmeOfPath("/breast/woman/abc")).toBe("breast");
  });
  it("places other screens in no programme", () => {
    expect(programmeOfPath("/data-quality/health")).toBeNull();
    expect(programmeOfPath("/breastfeeding")).toBeNull();
  });
});
