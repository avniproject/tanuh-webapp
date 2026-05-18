import { http } from "@/auth/httpClient";
import type { EncounterApiResponse, PagedResponse } from "./types";

const EPOCH = "2000-01-01T00:00:00.000Z";

interface ListParams {
  encounterType: string;
  subjectId?: string;
  page?: number;
  size?: number;
}

export async function listEncounters(params: ListParams): Promise<PagedResponse<EncounterApiResponse>> {
  const now = new Date().toISOString();
  const response = await http.get<PagedResponse<EncounterApiResponse>>("/api/encounters", {
    params: {
      lastModifiedDateTime: EPOCH,
      now,
      encounterType: params.encounterType,
      subjectId: params.subjectId,
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

export interface CreateEncounterBody {
  "Encounter type": string;
  "Subject ID": string;
  "Encounter date time": string;
  observations: Record<string, unknown>;
}

export async function submitEncounter(body: CreateEncounterBody): Promise<EncounterApiResponse> {
  const response = await http.post<EncounterApiResponse>("/api/encounter", body);
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
