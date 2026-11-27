import { http } from "@/auth/httpClient";
import { createLimiter } from "./limiter";
import type { PagedResponse } from "./types";

export interface CatchmentLocationNode {
  uuid: string;
  name: string;
  type: string;
  parentUuid: string | null;
}

export interface CatchmentLocationsResponse {
  nodes: CatchmentLocationNode[];
  rootUuids: string[];
}

export type EncounterStatus = "scheduled" | "completed" | "all";

export interface SubjectSummary {
  uuid: string;
  externalId: string | null;
  displayName: string;
  location: Record<string, string>;
}

export interface EncounterWithLocation {
  encounterUuid: string;
  encounterTypeName: string;
  encounterDateTime: string | null;
  earliestScheduledDate: string | null;
  voided: boolean;
  subject: SubjectSummary;
  // Display name (or username fallback) of the user who completed the
  // encounter. Null until the encounter is completed.
  lastModifiedBy: string | null;
}

export interface EncounterListParams {
  encounterType: string;
  status: EncounterStatus;
  locationUuid?: string | null;
  // Optional linked-observation filter — all three must be provided together.
  // Narrows the list to encounters whose subject has a completed encounter of
  // `linkedEncounterType` with the observation under `linkedObservationConceptUuid`
  // pointing at an AddressLevel in the subtree rooted at `linkedLocationUuid`.
  linkedEncounterType?: string | null;
  linkedObservationConceptUuid?: string | null;
  linkedLocationUuid?: string | null;
  page?: number;
  size?: number;
}

let catchmentCache: Promise<CatchmentLocationsResponse> | null = null;

export function getCatchmentLocations(): Promise<CatchmentLocationsResponse> {
  if (!catchmentCache) {
    catchmentCache = http
      .get<CatchmentLocationsResponse>("/api/impl/catchmentLocations")
      .then((r) => r.data)
      .catch((err) => {
        catchmentCache = null;
        throw err;
      });
  }
  return catchmentCache;
}

export function clearCatchmentCache(): void {
  catchmentCache = null;
}

// The server caps page size at 200; MAX_PAGES is a runaway guard. Fetching
// everything lets the completed tab filter, count and paginate client-side —
// correct across the whole list, not just one server page. If volumes outgrow
// this, the filters must move server-side (CPG-2170).
const FULL_FETCH_PAGE_SIZE = 200;
const FULL_FETCH_MAX_PAGES = 10;

export async function getAllEncountersWithLocation(
  p: Omit<EncounterListParams, "page" | "size">,
): Promise<{ content: EncounterWithLocation[]; totalElements: number }> {
  const first = await getEncountersWithLocation({ ...p, page: 0, size: FULL_FETCH_PAGE_SIZE });
  const content = [...first.content];
  const totalPages = Math.min(first.totalPages, FULL_FETCH_MAX_PAGES);
  for (let page = 1; page < totalPages; page++) {
    const next = await getEncountersWithLocation({ ...p, page, size: FULL_FETCH_PAGE_SIZE });
    content.push(...next.content);
  }
  return { content, totalElements: first.totalElements };
}

// The uuids of a type's encounters whose patient lives in the location's subtree, matched by the server as it matches
// the list's booked reviews. The pending tab's patient-location filter uses it for screening rows, so it needs no read
// per patient (tanuh-webapp#4 review). Standalone encounters only: the endpoint reads no program visits. After the
// first page the rest are read four at a time. `complete` is false when a page failed or the guard (the screening
// store's own, 20,000 rows) stopped the read short; the caller then keeps what it cannot place, and says so.
const LOCATION_LOOKUP_MAX_PAGES = 100;
const lookupPages = createLimiter(4);

export async function getEncounterUuidsInLocation(
  encounterType: string,
  status: EncounterStatus,
  locationUuid: string,
): Promise<{ uuids: Set<string>; complete: boolean }> {
  const uuids = new Set<string>();
  const read = async (page: number) => {
    const res = await getEncountersWithLocation({ encounterType, status, locationUuid, page, size: FULL_FETCH_PAGE_SIZE });
    for (const e of res.content) uuids.add(e.encounterUuid);
    return res.totalPages;
  };
  let totalPages: number;
  try {
    totalPages = await read(0);
  } catch {
    return { uuids, complete: false };
  }
  const pages = Math.min(totalPages, LOCATION_LOOKUP_MAX_PAGES);
  const rest = await Promise.allSettled(
    Array.from({ length: Math.max(0, pages - 1) }, (_, i) => lookupPages(() => read(i + 1))),
  );
  return { uuids, complete: totalPages <= LOCATION_LOOKUP_MAX_PAGES && rest.every((r) => r.status === "fulfilled") };
}

// A screening to place: its ID and its "Encounter date time".
export interface PlacementTarget {
  uuid: string;
  date: string | null;
}

const LOOKUP_BATCH = 4;

/**
 * Which of `targets` are completed encounters of the type in the location's subtree (PE-304). The server lists them
 * newest first (by encounter date, then id), so the read stops once every target is found here or elsewhere, or has been
 * passed: a target dated strictly after the last row read is not in the location. Dates are compared as times. After
 * the first page the pages are read four at a time, through the limiter `getEncounterUuidsInLocation` uses, so the
 * calls for several places together have at most four pages in flight. `foundElsewhere` is shared by the calls for one
 * load's places: each adds what it finds, and stops chasing what another found. A target in neither result set is
 * unsettled: the read failed, or stopped at the 100-page guard, before it could be placed or ruled out. Never throws.
 */
export async function findInLocation(
  encounterType: string,
  locationUuid: string,
  targets: readonly PlacementTarget[],
  foundElsewhere: Set<string>,
): Promise<{ found: Set<string>; ruledOut: Set<string> }> {
  const found = new Set<string>();
  const ruledOut = new Set<string>();
  const wanted = new Set(targets.map((t) => t.uuid));
  const open = () => targets.filter((t) => !foundElsewhere.has(t.uuid) && !ruledOut.has(t.uuid));
  if (open().length === 0) return { found, ruledOut };
  const read = (page: number) =>
    lookupPages(() =>
      getEncountersWithLocation({ encounterType, status: "completed", locationUuid, page, size: FULL_FETCH_PAGE_SIZE }),
    );
  // Takes one page, read in order; true when the read is over.
  const settle = (page: number, res: PagedResponse<EncounterWithLocation>): boolean => {
    for (const e of res.content) {
      if (!wanted.has(e.encounterUuid)) continue;
      found.add(e.encounterUuid);
      foundElsewhere.add(e.encounterUuid);
    }
    const last = page + 1 >= res.totalPages;
    const oldest = Date.parse(res.content[res.content.length - 1]?.encounterDateTime ?? "");
    for (const t of open()) {
      if (last || (t.date !== null && Date.parse(t.date) > oldest)) ruledOut.add(t.uuid);
    }
    return last || open().length === 0;
  };

  let first: PagedResponse<EncounterWithLocation>;
  try {
    first = await read(0);
  } catch {
    return { found, ruledOut };
  }
  if (settle(0, first)) return { found, ruledOut };
  const pages = Math.min(first.totalPages, LOCATION_LOOKUP_MAX_PAGES);
  for (let start = 1; start < pages; start += LOOKUP_BATCH) {
    const batch = Array.from({ length: Math.min(LOOKUP_BATCH, pages - start) }, (_, i) => start + i);
    const results = await Promise.allSettled(batch.map(read));
    for (let i = 0; i < batch.length; i++) {
      const result = results[i];
      if (result.status === "rejected") return { found, ruledOut };
      if (settle(batch[i], result.value)) return { found, ruledOut };
    }
  }
  return { found, ruledOut };
}

export async function getEncountersWithLocation(
  p: EncounterListParams,
): Promise<PagedResponse<EncounterWithLocation>> {
  const res = await http.get<PagedResponse<EncounterWithLocation>>(
    "/api/impl/encountersWithLocation",
    {
      params: {
        encounterType: p.encounterType,
        status: p.status,
        locationUuid: p.locationUuid ?? undefined,
        linkedEncounterType: p.linkedEncounterType ?? undefined,
        linkedObservationConceptUuid: p.linkedObservationConceptUuid ?? undefined,
        linkedLocationUuid: p.linkedLocationUuid ?? undefined,
        page: p.page ?? 0,
        size: p.size ?? 50,
      },
    },
  );
  return res.data;
}
