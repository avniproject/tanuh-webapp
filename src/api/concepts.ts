import axios from "axios";
import { http } from "@/auth/httpClient";
import { REVIEW_CATEGORY_CONCEPT } from "@/constants/tanuhConcepts";

export interface ConceptAnswer {
  uuid: string;
  name: string;
  order: number;
}

export interface ConceptResponse {
  uuid: string;
  name: string;
  dataType: string;
  voided: boolean;
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
  voided?: boolean;
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
  modelProbe = null;
}

// tanuh-webapp#4: the pending list from screenings applies only where the organisation has the high-risk model's
// "Review category" concept (Tanuh's configuration). Staging, and production before promotion, keep today's list.
// A voided concept counts as absent: the server still answers for it, with its name, which is how UAT's Data Quality
// gate stayed on after PE-136 voided that concept. Of the failures, only a 404 means "not here": avni-server answers a
// missing concept, or another organisation's, with 404 on every release line from 16.15 to 18.1. Any other failure (a
// 503 during a restart, a 500) fails the load and is asked again next time; treating it as "not here" would hide every
// case the model sent for review for the rest of the session.
let modelProbe: Promise<boolean> | null = null;
export function hasHighRiskModel(): Promise<boolean> {
  if (!modelProbe) {
    const uuid = REVIEW_CATEGORY_CONCEPT.uuid;
    modelProbe = getConcept(uuid)
      .then((c) => c.name === REVIEW_CATEGORY_CONCEPT.name && !c.voided)
      .catch((e: unknown) => {
        cache.delete(uuid);
        if (axios.isAxiosError(e) && e.response?.status === 404) return false;
        modelProbe = null;
        throw e;
      });
  }
  return modelProbe;
}

function normalise(raw: RawConceptProjection): ConceptResponse {
  const answers = (raw.conceptAnswers ?? [])
    .filter((a) => !a.voided && !a.answerConcept.voided)
    .map((a) => ({ uuid: a.answerConcept.uuid, name: a.answerConcept.name, order: a.order }))
    .sort((a, b) => a.order - b.order);
  return { uuid: raw.uuid, name: raw.name, dataType: raw.dataType, voided: raw.voided === true, answers };
}
