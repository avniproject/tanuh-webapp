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
}

export interface EncounterListParams {
  encounterType: string;
  status: EncounterStatus;
  locationUuid?: string | null;
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
        page: p.page ?? 0,
        size: p.size ?? 50,
      },
    },
  );
  return res.data;
}
