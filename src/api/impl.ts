import { http } from "@/auth/httpClient";
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
