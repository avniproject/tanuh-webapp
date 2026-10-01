import { describe, expect, it } from "vitest";
import { ENCOUNTER_TYPE } from "@/constants/tanuhConcepts";
import { buildScheduledVisitRequest, type ScheduleEncounterBody } from "./scheduledVisit";

const visit: ScheduleEncounterBody = {
  encounterType: ENCOUNTER_TYPE.highRiskFollowUp,
  subjectId: "subject-uuid",
  earliestVisitDateTime: "2026-10-01T00:00:00.000Z",
  maxVisitDateTime: "2026-10-08T00:00:00.000Z",
};

describe("buildScheduledVisitRequest", () => {
  it("schedules a standalone visit on /web/encounters against the subject", () => {
    const { url, body } = buildScheduledVisitRequest(visit, "visit-uuid");
    expect(url).toBe("/web/encounters");
    expect(body).toEqual({
      uuid: "visit-uuid",
      encounterTypeUUID: ENCOUNTER_TYPE.highRiskFollowUp.uuid,
      name: ENCOUNTER_TYPE.highRiskFollowUp.name,
      individualUUID: "subject-uuid",
      earliestVisitDateTime: "2026-10-01T00:00:00.000Z",
      maxVisitDateTime: "2026-10-08T00:00:00.000Z",
      observations: [],
      cancelObservations: [],
    });
  });

  it("schedules a program visit on /web/programEncounters inside the enrolment", () => {
    const { url, body } = buildScheduledVisitRequest(
      { ...visit, encounterType: ENCOUNTER_TYPE.referralSlip, enrolmentId: "enrolment-uuid" },
      "visit-uuid",
    );
    expect(url).toBe("/web/programEncounters");
    expect(body.programEnrolmentUUID).toBe("enrolment-uuid");
    expect(body).not.toHaveProperty("individualUUID");
    expect(body.encounterTypeUUID).toBe(ENCOUNTER_TYPE.referralSlip.uuid);
  });

  it("always names the visit after its type (PE-125)", () => {
    for (const enrolmentId of [undefined, "enrolment-uuid"]) {
      const { body } = buildScheduledVisitRequest({ ...visit, enrolmentId }, "visit-uuid");
      expect(body.name).toBe("High Risk Referral");
    }
  });
});
