import {
  AI_VERDICT_GROUP,
  AI_VERDICT_GROUP_CHILD,
  EDGE_AI_VERDICT_CONCEPT,
  OCSHR_RESULT_CONCEPT,
  OCSHR_RESULT_VALUES,
  ORAL_IMAGE_GROUP,
  ORAL_IMAGE_GROUP_CHILD,
  ORAL_SCREENING_GROUP,
  PLACE_OF_REFERRAL_CONCEPT,
  RANDOM_SAMPLE_ID_CONCEPT,
  VERDICT_VALUES,
  VISUAL_EXAM_CONCEPTS,
  WORKER_OPINION,
  codedAnswerName,
  deriveWorkerOpinion,
  readObs,
  type QueueGroup,
} from "@/constants/tanuhConcepts";

// The three signals that decide which queue group a screening lands in (PE-249).
export type EdgeVerdict = "Suspicious" | "Non-Suspicious";
export type OcshrResult = "High Risk" | "Not High Risk";

export interface CaseSignals {
  flwPositive: boolean;
  edge?: EdgeVerdict;
  ocshr?: OcshrResult;
  randomSampleId?: number;
}

const SAFETY_SAMPLE_BELOW = 0.05;

function rowsOf(obs: Record<string, unknown>, name: string): Record<string, unknown>[] {
  const v = obs[name];
  const list = Array.isArray(v) ? v : v && typeof v === "object" ? [v] : [];
  return list.filter((r): r is Record<string, unknown> => !!r && typeof r === "object");
}

function hasPhoto(obs: Record<string, unknown>): boolean {
  return [ORAL_IMAGE_GROUP.name, ORAL_SCREENING_GROUP.name].some((g) =>
    rowsOf(obs, g).some((r) => readObs(r, ORAL_IMAGE_GROUP_CHILD.image) !== undefined),
  );
}

function hasValue(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== "";
}

// A referral reaches the Clinician Review on the phone only when the mouth opens or a photo was taken, so the
// queue counts it as the worker marking the case in the same cases.
export function deriveFlwPositive(obs: Record<string, unknown>): boolean {
  if (deriveWorkerOpinion(obs) === WORKER_OPINION.suspicious) return true;
  if (!hasValue(readObs(obs, PLACE_OF_REFERRAL_CONCEPT))) return false;
  const mouthClosed = codedAnswerName(readObs(obs, VISUAL_EXAM_CONCEPTS.ableToOpenMouth)) === "No";
  return !mouthClosed || hasPhoto(obs);
}

function asEdge(v: unknown): EdgeVerdict | undefined {
  const s = codedAnswerName(v);
  return s === VERDICT_VALUES.suspicious || s === VERDICT_VALUES.nonSuspicious ? s : undefined;
}

// The final verdict concept wins; when it is empty the per-image AI rows stand in for it.
export function deriveEdgeVerdict(obs: Record<string, unknown>): EdgeVerdict | undefined {
  const fromConcept = asEdge(readObs(obs, EDGE_AI_VERDICT_CONCEPT));
  if (fromConcept) return fromConcept;
  const verdicts = rowsOf(obs, AI_VERDICT_GROUP.name).map((r) => codedAnswerName(readObs(r, AI_VERDICT_GROUP_CHILD.verdict)));
  if (verdicts.includes(VERDICT_VALUES.suspicious)) return VERDICT_VALUES.suspicious;
  if (verdicts.includes(VERDICT_VALUES.nonSuspicious)) return VERDICT_VALUES.nonSuspicious;
  return undefined;
}

function ocshrOf(obs: Record<string, unknown>): OcshrResult | undefined {
  const s = codedAnswerName(readObs(obs, OCSHR_RESULT_CONCEPT));
  return s === OCSHR_RESULT_VALUES.highRisk || s === OCSHR_RESULT_VALUES.notHighRisk ? s : undefined;
}

function sampleIdOf(obs: Record<string, unknown>): number | undefined {
  const v = readObs(obs, RANDOM_SAMPLE_ID_CONCEPT);
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

// A cached flwPositive / edgeVerdict (null = known to be undetermined) is trusted over re-deriving from the rows.
export function signalsOf(e: {
  observations?: Record<string, unknown>;
  flwPositive?: boolean;
  edgeVerdict?: EdgeVerdict | null;
}): CaseSignals {
  const obs = e.observations ?? {};
  return {
    flwPositive: e.flwPositive ?? deriveFlwPositive(obs),
    edge: e.edgeVerdict !== undefined ? (e.edgeVerdict ?? undefined) : deriveEdgeVerdict(obs),
    ocshr: ocshrOf(obs),
    randomSampleId: sampleIdOf(obs),
  };
}

export interface CaseClass {
  group?: QueueGroup;
  ocshrPending: boolean;
}

// Worker first, then either model; a safety sample needs every signal negative and a low Random Sample ID.
export function classify(s: CaseSignals): CaseClass {
  const ocshrPending = s.ocshr === undefined;
  let group: QueueGroup | undefined;
  if (s.flwPositive) group = "FLW marked";
  else if (s.edge === VERDICT_VALUES.suspicious || s.ocshr === OCSHR_RESULT_VALUES.highRisk) group = "AI marked";
  else if (
    s.edge === VERDICT_VALUES.nonSuspicious &&
    s.ocshr === OCSHR_RESULT_VALUES.notHighRisk &&
    s.randomSampleId !== undefined &&
    s.randomSampleId >= 0 &&
    s.randomSampleId < SAFETY_SAMPLE_BELOW
  )
    group = "Safety sample";
  return { group, ocshrPending };
}

export function isReady(c: CaseClass): boolean {
  return c.group !== undefined && !c.ocshrPending;
}
