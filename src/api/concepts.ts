import { http } from "@/auth/httpClient";

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

function normalise(raw: RawConceptProjection): ConceptResponse {
  const answers = (raw.conceptAnswers ?? [])
    .filter((a) => !a.voided && !a.answerConcept.voided)
    .map((a) => ({ uuid: a.answerConcept.uuid, name: a.answerConcept.name, order: a.order }))
    .sort((a, b) => a.order - b.order);
  return { uuid: raw.uuid, name: raw.name, dataType: raw.dataType, answers };
}
