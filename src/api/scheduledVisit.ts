/**
 * A planned visit in the shape Avni's own clients save it (avni-models
 * AbstractEncounter.toResource, sent by avni-webapp to POST /web/encounters and
 * /web/programEncounters). Unlike the external /api/encounter request, this one
 * carries the visit `name`: the mobile New Visit screen translates that name
 * with no fallback, so a nameless planned visit shows `[missing "en::::"
 * translation]` (PE-125). Kept free of the http client so it is unit-testable.
 */
export interface ScheduleEncounterBody {
  encounterType: { name: string; uuid: string };
  subjectId: string;
  // Set to schedule a PROGRAM visit inside that enrolment; absent = a
  // standalone visit.
  enrolmentId?: string;
  earliestVisitDateTime: string;
  maxVisitDateTime: string;
}

export interface ScheduledVisitRequest {
  url: "/web/programEncounters" | "/web/encounters";
  body: Record<string, unknown>;
}

export function buildScheduledVisitRequest(visit: ScheduleEncounterBody, uuid: string): ScheduledVisitRequest {
  const common = {
    uuid,
    encounterTypeUUID: visit.encounterType.uuid,
    // Named after its type, as the server names a rule-scheduled visit.
    name: visit.encounterType.name,
    earliestVisitDateTime: visit.earliestVisitDateTime,
    maxVisitDateTime: visit.maxVisitDateTime,
    // The server streams observations unconditionally: [] — never omitted.
    observations: [],
    cancelObservations: [],
  };
  if (visit.enrolmentId) {
    return { url: "/web/programEncounters", body: { ...common, programEnrolmentUUID: visit.enrolmentId } };
  }
  return { url: "/web/encounters", body: { ...common, individualUUID: visit.subjectId } };
}
