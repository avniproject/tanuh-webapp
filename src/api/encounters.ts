import { http } from "@/auth/httpClient";
import { ENCOUNTER_ID_CONCEPT, REVIEWED_ORAL_SCREENING_CONCEPT, readObs } from "@/constants/tanuhConcepts";
import { getConcept } from "./concepts";
import { idbGet, idbSet } from "./idbStore";
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
  // Lower bound of the server's lastModified window (inclusive). Defaults to
  // EPOCH (everything). The delta cache passes its watermark here to fetch only
  // rows changed since the last sweep.
  lastModifiedDateTime?: string;
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
      lastModifiedDateTime: params.lastModifiedDateTime ?? EPOCH,
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
  invalidateCachedEncounters();
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

// ---------------------------------------------------------------------------
// Persistent + delta-updated encounter cache (warm replacement for the
// unfiltered sweepEncounters above).
//
// A completed encounter's observations, dates and pairing stamp never change,
// so instead of re-sweeping the whole org on every list load we persist the
// swept rows in IndexedDB and, on the next load, fetch only the rows changed
// since the last sweep (the stock /api/encounters `lastModifiedDateTime`
// window) and merge. First load is a full sweep (cold cache); every load after
// transfers only the delta.
//
// Correctness: the server filters `last_modified_date_time BETWEEN from AND to`
// (inclusive) ordered oldest-first, so re-requesting from the stored watermark
// (minus a small overlap) and upserting by ID cannot drop a row that ties on a
// timestamp boundary. Voids arrive in the delta as Voided=true and upsert over
// the cached copy; the pairing consumers already filter voided. Hard deletes
// (rare in Avni — voiding is the norm) are not reconciled.
//
// Rows are trimmed to only the fields getReviewScreeningPairing /
// getLatestScreeningInfoBySubject read, so the store stays small (no image
// group / photo-URL arrays). Bump CACHE_SCHEMA if that field set changes.
// ---------------------------------------------------------------------------
const CACHE_SCHEMA = 1;
const CACHE_OVERLAP_MS = 5 * 60 * 1000;
const CACHE_COLD_PAGE_CAP = 200; // ~20k rows; one-time cold-start guard
const CACHE_PAGE_SIZE = 100;

interface CachedEncounters {
  schema: number;
  watermark: string; // max "Last modified at" seen so far, ISO
  records: EncounterApiResponse[];
}

// Keep only the fields the pairing/screening-info consumers read; drop the rest
// (notably the heavy repeatable image groups) so the persisted set stays tiny.
function trimForCache(e: EncounterApiResponse): EncounterApiResponse {
  const obs: Record<string, unknown> = {};
  for (const ref of [ENCOUNTER_ID_CONCEPT, REVIEWED_ORAL_SCREENING_CONCEPT]) {
    const v = e.observations?.[ref.name];
    if (v !== undefined) obs[ref.name] = v;
  }
  return {
    ID: e.ID,
    "Subject ID": e["Subject ID"],
    "Subject external ID": e["Subject external ID"],
    "Subject type": e["Subject type"],
    Voided: e.Voided,
    "External ID": e["External ID"],
    "Encounter type": e["Encounter type"],
    "Encounter date time": e["Encounter date time"],
    "Earliest scheduled date": e["Earliest scheduled date"],
    "Max scheduled date": e["Max scheduled date"],
    "Cancel date time": e["Cancel date time"],
    observations: obs,
    audit: {
      "Created at": e.audit?.["Created at"],
      "Created by": e.audit?.["Created by"],
      "Last modified at": e.audit?.["Last modified at"],
    },
  };
}

async function fetchEncountersSince(
  encounterType: string,
  since: string,
): Promise<EncounterApiResponse[]> {
  const all: EncounterApiResponse[] = [];
  for (let page = 0; page < CACHE_COLD_PAGE_CAP; page++) {
    const res = await listEncounters({
      encounterType,
      lastModifiedDateTime: since,
      page,
      size: CACHE_PAGE_SIZE,
    });
    all.push(...res.content);
    if (page + 1 >= res.totalPages) break;
  }
  return all;
}

const cachedLayerMemo = new Map<string, { at: number; promise: Promise<EncounterApiResponse[]> }>();

/**
 * Warm-cache + delta replacement for `sweepEncounters(type)` (unfiltered). Reads
 * the type's full org set from IndexedDB and tops it up with only the rows
 * changed since the last call, so repeat list loads no longer re-sweep the org.
 * On any storage failure it still returns a correct set (a full fetch), just
 * without the persistence benefit.
 */
export function getCachedEncounters(encounterType: string): Promise<EncounterApiResponse[]> {
  const memo = cachedLayerMemo.get(encounterType);
  if (memo && Date.now() - memo.at < SWEEP_TTL_MS) return memo.promise;
  const key = `enc-cache:${encounterType}`;
  const promise = (async () => {
    let cached = await idbGet<CachedEncounters>(key);
    if (!cached || cached.schema !== CACHE_SCHEMA) {
      cached = { schema: CACHE_SCHEMA, watermark: EPOCH, records: [] };
    }
    const since =
      cached.watermark === EPOCH
        ? EPOCH
        : new Date(Date.parse(cached.watermark) - CACHE_OVERLAP_MS).toISOString();
    const fresh = await fetchEncountersSince(encounterType, since);
    const byId = new Map(cached.records.map((r) => [r.ID, r]));
    let maxLm = Date.parse(cached.watermark);
    for (const e of fresh) {
      byId.set(e.ID, trimForCache(e));
      const lm = Date.parse(e.audit?.["Last modified at"] ?? "");
      if (!Number.isNaN(lm) && lm > maxLm) maxLm = lm;
    }
    const records = [...byId.values()];
    const next: CachedEncounters = {
      schema: CACHE_SCHEMA,
      watermark: Number.isNaN(maxLm) ? EPOCH : new Date(maxLm).toISOString(),
      records,
    };
    void idbSet(key, next);
    return records;
  })();
  cachedLayerMemo.set(encounterType, { at: Date.now(), promise });
  promise.catch(() => cachedLayerMemo.delete(encounterType));
  return promise;
}

// Drop the in-memory memo so the next getCachedEncounters call issues a fresh
// delta fetch (e.g. right after a review submit). The persistent store is kept —
// the delta picks up the just-written row via its bumped lastModified.
export function invalidateCachedEncounters(): void {
  cachedLayerMemo.clear();
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
    getCachedEncounters(reviewEncounterType),
    getCachedEncounters(screeningEncounterType),
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
  const all = await getCachedEncounters(encounterType);
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
