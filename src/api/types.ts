// Observations are keyed by concept *name* (Response.java#mapObservations
// in avni-server), so call sites look up values by the concept's display name.
export interface EncounterApiResponse {
  ID: string;
  "Subject ID": string;
  "Subject external ID": string | null;
  "Subject type": string;
  Voided: boolean;
  "External ID": string | null;
  "Encounter type": string;
  "Encounter date time": string | null;
  "Earliest scheduled date": string | null;
  "Max scheduled date": string | null;
  "Cancel date time": string | null;
  observations: Record<string, unknown>;
  cancelObservations?: Record<string, unknown>;
  audit?: {
    "Created at"?: string;
    "Last modified at"?: string;
    "Created by"?: string;
    "Last modified by"?: string;
  };
}

export interface PagedResponse<T> {
  content: T[];
  totalElements: number;
  totalPages: number;
  pageSize: number;
}

export interface SubjectApiResponse {
  ID: string;
  "External ID": string | null;
  "Subject type": string;
  Voided: boolean;
  "Registration Coordinates"?: { x: number; y: number };
  "Registration date"?: string;
  // For Person subjects, demographic fields (First name, Last name, Date of
  // birth, Gender) live inside observations, not at the top level.
  observations: Record<string, unknown>;
  audit?: Record<string, string>;
  // Keyed by address-level type name. For Tanuh: State, District, Block, Village.
  location?: Record<string, string | null>;
}
