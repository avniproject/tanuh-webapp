import axios from "axios";
import { http } from "@/auth/httpClient";
import { SCREENING_DATA_QUALITY_CONCEPT } from "@/constants/tanuhConcepts";

export interface ConceptAnswer {
  uuid: string;
  name: string;
  order: number;
}

export interface ConceptResponse {
  uuid: string;
  name: string;
  dataType: string;
  answers: ConceptAnswer[];
}

interface RawConceptAnswerProjection {
  uuid: string;
  order: number;
  voided?: boolean;
  answerConcept: { uuid: string; name: string; voided?: boolean };
}

interface RawConceptProjection {
  uuid: string;
  name: string;
  dataType: string;
  conceptAnswers?: RawConceptAnswerProjection[];
}

const cache = new Map<string, Promise<ConceptResponse>>();

export function getConcept(uuid: string): Promise<ConceptResponse> {
  let cached = cache.get(uuid);
  if (!cached) {
    cached = http.get<RawConceptProjection>(`/web/concept/${uuid}`).then((r) => normalise(r.data));
    cache.set(uuid, cached);
  }
  return cached;
}

// Forget every cached concept — called when a different org/user signs in on
// the same page, since /web/concept answers are org-scoped.
export function resetConceptCache(): void {
  cache.clear();
  gateProbe = null;
}

// PE-96: the Data Quality gate (Pass-only list, AI Risk column, Data Quality card)
// applies only to an org whose bundle carries the "Data Quality" concept. Every
// Tanuh org signs in to the same webapp, so the org is detected, not assumed:
// UAT 1071 has the concept; staging 1187 and prod 1113 do not, and for them the
// list behaves exactly as before. The server throws EntityNotFoundException
// ("Concept not found with uuid …") for a missing concept, and row-level security
// hides another org's concept the same way; whatever status that maps to, ANY
// HTTP error answer means "this org does not have it" — the gate is off. Only a
// request that never reached the server (network, CORS) propagates, so a real
// outage still shows "Failed to load" instead of a silently ungated list.
// One probe per sign-in; reset with the encounter cache scope.
let gateProbe: Promise<boolean> | null = null;
export function hasScreeningQualityGate(): Promise<boolean> {
  if (!gateProbe) {
    const uuid = SCREENING_DATA_QUALITY_CONCEPT.uuid;
    gateProbe = getConcept(uuid)
      .then((c) => c.name === SCREENING_DATA_QUALITY_CONCEPT.name)
      .catch((e: unknown) => {
        cache.delete(uuid); // a rejected probe must not be pinned in the concept cache
        if (axios.isAxiosError(e) && e.response) {
          if (e.response.status !== 404)
            console.warn(`[PE-96] Data Quality probe answered ${e.response.status}; treating as "org has no concept"`);
          return false;
        }
        gateProbe = null; // transient: probe again on the next load
        throw e;
      });
  }
  return gateProbe;
}

function normalise(raw: RawConceptProjection): ConceptResponse {
  const answers = (raw.conceptAnswers ?? [])
    .filter((a) => !a.voided && !a.answerConcept.voided)
    .map((a) => ({ uuid: a.answerConcept.uuid, name: a.answerConcept.name, order: a.order }))
    .sort((a, b) => a.order - b.order);
  return { uuid: raw.uuid, name: raw.name, dataType: raw.dataType, answers };
}
