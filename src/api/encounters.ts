import { http } from "@/auth/httpClient";
import { getConcept } from "./concepts";
import type { EncounterApiResponse, PagedResponse } from "./types";

const EPOCH = "2000-01-01T00:00:00.000Z";

interface ListParams {
  encounterType: string;
  subjectId?: string;
  // Server-side observation filter (stock /api/encounters `concepts` param):
  // keys are concept NAMES, values are compared against the RAW stored
  // observation — for a single-select Coded concept that is the answer
  // concept's uuid, not its display name.
  concepts?: Record<string, string>;
  page?: number;
  size?: number;
}

export async function listEncounters(params: ListParams): Promise<PagedResponse<EncounterApiResponse>> {
  // `now` is the required upper bound of the server's lastModified window.
  // Pad it forward so a physician machine with a slow clock cannot hide
  // recently-synced encounters.
  const now = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const response = await http.get<PagedResponse<EncounterApiResponse>>("/api/encounters", {
    params: {
      lastModifiedDateTime: EPOCH,
      now,
      encounterType: params.encounterType,
      subjectId: params.subjectId,
      concepts: params.concepts ? JSON.stringify(params.concepts) : undefined,
      page: params.page ?? 0,
      size: params.size ?? 50,
    },
  });
  return response.data;
}

export async function getEncounter(uuid: string): Promise<EncounterApiResponse> {
  const response = await http.get<EncounterApiResponse>(`/api/encounter/${uuid}`);
  return response.data;
}

export interface UpsertEncounterBody {
  "Encounter type": string;
  "Subject ID": string;
  "Encounter date time": string;
  observations: Record<string, unknown>;
}

/**
 * When `uuid` is provided, transitions an existing encounter (typically a
 * scheduled one) into a completed state via `PUT /api/encounter/{uuid}`.
 * When `uuid` is null, POSTs a brand-new encounter. The Tanuh Physician
 * Review flow always passes the scheduled review's UUID so the same row is
 * updated rather than a duplicate being created.
 */
export async function submitEncounter(
  uuid: string | null,
  body: UpsertEncounterBody,
): Promise<EncounterApiResponse> {
  // The avni-server PUT/POST handler always calls
  // `createObservations(request.getCancelObservations())` and NPEs if the
  // field is null. Always send an empty cancelObservations so we never hit
  // that path — we're never cancelling here, only completing.
  const payload = { cancelObservations: {}, ...body };
  if (uuid) {
    const response = await http.put<EncounterApiResponse>(`/api/encounter/${uuid}`, payload);
    return response.data;
  }
  const response = await http.post<EncounterApiResponse>("/api/encounter", payload);
  return response.data;
}

export interface ScheduleEncounterBody {
  "Encounter type": string;
  "Subject ID": string;
  "Earliest scheduled date": string;
  "Max scheduled date": string;
}

/**
 * Creates a *scheduled* (not yet performed) visit: POST /api/encounter with
 * scheduled dates and no "Encounter date time". Workers in the subject's
 * catchment see it on mobile as a due visit under the encounter type's list
 * and complete it there.
 */
export async function scheduleEncounter(body: ScheduleEncounterBody): Promise<EncounterApiResponse> {
  // observations/cancelObservations must be present (server NPEs on null).
  const payload = { observations: {}, cancelObservations: {}, ...body };
  const response = await http.post<EncounterApiResponse>("/api/encounter", payload);
  return response.data;
}

/**
 * A scheduled visit in Avni: has an earliest visit time, but encounter has
 * not been completed and was not cancelled.
 */
export function isScheduled(encounter: EncounterApiResponse): boolean {
  return (
    encounter["Encounter date time"] == null &&
    encounter["Cancel date time"] == null &&
    encounter["Earliest scheduled date"] != null &&
    !encounter.Voided
  );
}

export function isCompleted(encounter: EncounterApiResponse): boolean {
  return encounter["Encounter date time"] != null && !encounter.Voided;
}

// ---------------------------------------------------------------------------
// Org-wide encounter sweeps. The list tabs remount on every tab switch and
// each mount needs the same data (High Risk set, latest screening per
// subject), so results are cached for a short TTL; a successful review submit
// invalidates so fresh work shows immediately. PAGE_CAP bounds every sweep:
// if the org outgrows it, the lookup must move server-side (CPG-2170), not
// the cap raised — the sweep API pages oldest-first, so past the cap it is
// the NEWEST encounters that would go missing.
// ---------------------------------------------------------------------------
const SWEEP_PAGE_CAP = 30;
const SWEEP_PAGE_SIZE = 100;
const SWEEP_TTL_MS = 60 * 1000;

const sweepCache = new Map<string, { at: number; promise: Promise<EncounterApiResponse[]> }>();

// Call after any write that changes encounters (review submit) so the list
// tabs stop serving pre-write cached sweeps.
export function invalidateEncounterSweeps(): void {
  sweepCache.clear();
}

export function sweepEncounters(
  encounterType: string,
  concepts?: Record<string, string>,
): Promise<EncounterApiResponse[]> {
  const key = concepts ? `${encounterType}|${JSON.stringify(concepts)}` : encounterType;
  const cached = sweepCache.get(key);
  if (cached && Date.now() - cached.at < SWEEP_TTL_MS) return cached.promise;
  const promise = (async () => {
    const all: EncounterApiResponse[] = [];
    for (let page = 0; page < SWEEP_PAGE_CAP; page++) {
      const res = await listEncounters({ encounterType, concepts, page, size: SWEEP_PAGE_SIZE });
      all.push(...res.content);
      if (page + 1 >= res.totalPages) break;
    }
    return all;
  })();
  sweepCache.set(key, { at: Date.now(), promise });
  promise.catch(() => sweepCache.delete(key));
  return promise;
}

/**
 * Uuids of completed encounters whose single-select Coded observation equals
 * the given answer — the completed list's High Risk filter/count. Filtering
 * happens SERVER-side via the stock `concepts` param (the stored value is the
 * answer concept's uuid, resolved from the cached concept answers), so the
 * sweep only transfers matching encounters.
 */
export async function findCompletedEncounterUuidsWithCodedValue(
  encounterType: string,
  concept: { name: string; uuid: string },
  answerName: string,
): Promise<Set<string>> {
  const { answers } = await getConcept(concept.uuid);
  const answer = answers.find((a) => a.name === answerName);
  if (!answer) return new Set();
  const matching = await sweepEncounters(encounterType, { [concept.name]: answer.uuid });
  return new Set(matching.filter(isCompleted).map((e) => e.ID));
}

export interface LatestScreeningInfo {
  screeningDate: string;
  caseId: string;
  healthWorker: string;
}

/**
 * Latest completed encounter of a type per subject — feeds the list rows'
 * screening date / Case ID / health-worker columns from ONE org-wide sweep
 * instead of a request per subject per page.
 */
export async function getLatestScreeningInfoBySubject(
  encounterType: string,
): Promise<Record<string, LatestScreeningInfo>> {
  const all = await sweepEncounters(encounterType);
  const latest: Record<string, EncounterApiResponse> = {};
  for (const encounter of all) {
    if (!isCompleted(encounter)) continue;
    const subjectId = encounter["Subject ID"];
    const current = latest[subjectId];
    if (
      !current ||
      (encounter["Encounter date time"] || "").localeCompare(current["Encounter date time"] || "") > 0
    ) {
      latest[subjectId] = encounter;
    }
  }
  return Object.fromEntries(
    Object.entries(latest).map(([subjectId, encounter]) => [
      subjectId,
      {
        screeningDate: encounter["Encounter date time"] ?? "",
        caseId: encounter["Subject external ID"] ?? "",
        healthWorker: encounter.audit?.["Created by"] ?? "",
      },
    ]),
  );
}
