import { http } from "@/auth/httpClient";
import { ENCOUNTER_ID_CONCEPT, REVIEWED_ORAL_SCREENING_CONCEPT, readObs } from "@/constants/tanuhConcepts";
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

/**
 * Next Encounter ID for an encounter being completed, mirroring the mobile
 * decision rule: sequence = max(count of the subject's other performed
 * encounters of the type, highest numeric suffix already issued) + 1, so a
 * voided mid-sequence encounter can never cause a number to be re-issued.
 * Returns null when the subject has no Patient ID — like the rule, no id is
 * written at all in that case.
 */
export function computeNextEncounterId(
  patientId: string | null | undefined,
  typeCode: string,
  siblings: EncounterApiResponse[],
  selfUuid: string,
): string | null {
  if (!patientId) return null;
  const performed = siblings.filter(
    (e) => e.ID !== selfUuid && !e.Voided && e["Encounter date time"] != null,
  );
  let sequence = performed.length;
  for (const e of performed) {
    const previousId = readObs<string>(e.observations ?? {}, ENCOUNTER_ID_CONCEPT);
    const match = previousId?.match(/(\d+)\s*$/);
    if (match && parseInt(match[1], 10) > sequence) sequence = parseInt(match[1], 10);
  }
  return patientId + typeCode + String(sequence + 1).padStart(3, "0");
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
  screeningUuid: string;
  screeningDate: string;
  caseId: string;
  encounterId: string;
  healthWorker: string;
}

// Sortable creation key. A completed Oral Screening schedules its review
// immediately, so ordering both by creation time keeps a subject's screenings
// and reviews aligned for index pairing.
function createdAtKey(e: EncounterApiResponse): string {
  return e.audit?.["Created at"] ?? e["Encounter date time"] ?? e["Earliest scheduled date"] ?? "";
}

function toScreeningInfo(screening: EncounterApiResponse): LatestScreeningInfo {
  return {
    screeningUuid: screening.ID,
    screeningDate: screening["Encounter date time"] ?? "",
    caseId: screening["Subject external ID"] ?? "",
    encounterId: readObs<string>(screening.observations ?? {}, ENCOUNTER_ID_CONCEPT) ?? "",
    healthWorker: screening.audit?.["Created by"] ?? "",
  };
}

function groupBySubject(encounters: EncounterApiResponse[]): Record<string, EncounterApiResponse[]> {
  const bySubject: Record<string, EncounterApiResponse[]> = {};
  for (const e of encounters) (bySubject[e["Subject ID"]] ??= []).push(e);
  return bySubject;
}

/**
 * Pair each of a subject's review encounters to the specific Oral Screening it
 * covers. A stamped review (`Reviewed Oral Screening` = the screening's UUID)
 * is authoritative and freezes that pairing; unstamped reviews (legacy +
 * still-pending) fall back to created-order index pairing against the
 * screenings not already claimed by a stamp. Returns reviewUuid -> screening.
 */
export function pairReviewsToScreenings(
  reviews: EncounterApiResponse[],
  screenings: EncounterApiResponse[],
): Map<string, EncounterApiResponse> {
  const completed = screenings
    .filter(isCompleted)
    .sort((a, b) => createdAtKey(a).localeCompare(createdAtKey(b)));
  const byUuid = new Map(completed.map((s) => [s.ID, s]));
  const result = new Map<string, EncounterApiResponse>();
  const claimed = new Set<string>();
  const active = reviews.filter((r) => !r.Voided);
  // 1) stamped reviews claim their exact screening
  for (const r of active) {
    const stamp = readObs<string>(r.observations ?? {}, REVIEWED_ORAL_SCREENING_CONCEPT);
    if (stamp && byUuid.has(stamp)) {
      result.set(r.ID, byUuid.get(stamp)!);
      claimed.add(stamp);
    }
  }
  // 2) unstamped reviews pair with the remaining screenings, oldest-first
  const unstamped = active
    .filter((r) => !result.has(r.ID))
    .sort((a, b) => createdAtKey(a).localeCompare(createdAtKey(b)));
  const unclaimed = completed.filter((s) => !claimed.has(s.ID));
  unstamped.forEach((r, i) => {
    const screening = unclaimed[i] ?? completed[completed.length - 1];
    if (screening) result.set(r.ID, screening);
  });
  return result;
}

/**
 * reviewUuid -> the screening info its row should show. Built from two cached
 * org-wide sweeps (reviews with obs for the stamp, screenings for Case IDs), so
 * each of a subject's reviews shows its OWN screening's Case ID instead of all
 * collapsing onto the subject's latest screening.
 */
export async function getReviewScreeningPairing(
  reviewEncounterType: string,
  screeningEncounterType: string,
): Promise<Record<string, LatestScreeningInfo>> {
  const [reviewsAll, screeningsAll] = await Promise.all([
    sweepEncounters(reviewEncounterType),
    sweepEncounters(screeningEncounterType),
  ]);
  const reviewsBySubject = groupBySubject(reviewsAll.filter((r) => !r.Voided));
  const screeningsBySubject = groupBySubject(screeningsAll);
  const pairing: Record<string, LatestScreeningInfo> = {};
  for (const [subjectId, reviews] of Object.entries(reviewsBySubject)) {
    const paired = pairReviewsToScreenings(reviews, screeningsBySubject[subjectId] ?? []);
    for (const [reviewUuid, screening] of paired) pairing[reviewUuid] = toScreeningInfo(screening);
  }
  return pairing;
}

/**
 * Latest completed screening per subject — the fallback label for a review row
 * whose pairing can't be resolved (e.g. a review beyond the sweep cap).
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
    Object.entries(latest).map(([subjectId, encounter]) => [subjectId, toScreeningInfo(encounter)]),
  );
}
