import { format, isValid, parseISO } from "date-fns";
import {
  AI_VERDICT_GROUP,
  AI_VERDICT_GROUP_CHILD,
  OCSHR_CALL_MADE_CONCEPT,
  OCSHR_ERROR_CODE_CONCEPT,
  OCSHR_ERROR_CONCEPT,
  OCSHR_FAILED_STATUSES,
  OCSHR_PROBABILITY_CONCEPT,
  OCSHR_PROCESSED_TIME_CONCEPT,
  OCSHR_RESULT_VALUES,
  OCSHR_STATUS_CONCEPT,
  OCSHR_VERSION_CONCEPT,
  PLACE_OF_REFERRAL_CONCEPT,
  QC_STATUS_CONCEPT,
  QC_STATUS_VALUES,
  VERDICT_VALUES,
  WORKER_OPINION,
  codedAnswerName,
  deriveWorkerOpinion,
  readObs,
} from "@/constants/tanuhConcepts";
import { classify, deriveEdgeVerdict, signalsOf } from "./caseSignals";

// Everything the case page's "Screening signals" section shows, read from one screening (PE-250).
export type OcshrState = "scored" | "pending" | "unavailable";
export interface SignalDetails {
  flw: { verdict?: "Suspicious" | "Non-Suspicious"; referralRaised: boolean };
  edge: { verdict?: "Suspicious" | "Non-Suspicious"; flagged?: { suspicious: number; of: number } };
  ocshr: { state: OcshrState; resultText: string; statusLine: string; probability?: string; version?: string };
  safetySample: boolean; // group is Safety sample and ocshr.state is "scored"
}

function text(v: unknown): string | undefined {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? undefined : s;
}

// Up to four decimals, trailing zeros dropped: 0.4999 stays "0.4999" rather than rounding to "0.50".
function probabilityOf(v: unknown): string | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= 1 ? String(Number(n.toFixed(4))) : undefined;
}

function processedAt(v: unknown): string | undefined {
  const s = text(v);
  if (!s) return undefined;
  const d = parseISO(s);
  return isValid(d) ? format(d, "dd MMM yyyy, h:mm a") : undefined;
}

function flaggedOf(obs: Record<string, unknown>): { suspicious: number; of: number } | undefined {
  const v = obs[AI_VERDICT_GROUP.name];
  const rows = Array.isArray(v) ? v : v && typeof v === "object" ? [v] : [];
  const verdicts = rows
    .map((r) => (r && typeof r === "object" ? codedAnswerName(readObs(r as Record<string, unknown>, AI_VERDICT_GROUP_CHILD.verdict)) : undefined))
    .filter((x) => x === VERDICT_VALUES.suspicious || x === VERDICT_VALUES.nonSuspicious);
  if (verdicts.length === 0) return undefined;
  return { suspicious: verdicts.filter((x) => x === VERDICT_VALUES.suspicious).length, of: verdicts.length };
}

function ocshrOf(obs: Record<string, unknown>, hasResult: boolean, resultValue?: string): SignalDetails["ocshr"] {
  const status = text(readObs(obs, OCSHR_STATUS_CONCEPT))?.toUpperCase();
  const error = text(readObs(obs, OCSHR_ERROR_CONCEPT));
  const code = text(readObs(obs, OCSHR_ERROR_CODE_CONCEPT));
  const failed = (OCSHR_FAILED_STATUSES as readonly string[]).includes(status ?? "") || error !== undefined;
  const qcFail = text(readObs(obs, QC_STATUS_CONCEPT))?.toLowerCase() === QC_STATUS_VALUES.fail.toLowerCase();
  const callMade = codedAnswerName(readObs(obs, OCSHR_CALL_MADE_CONCEPT));

  const probability = probabilityOf(readObs(obs, OCSHR_PROBABILITY_CONCEPT));
  const version = text(readObs(obs, OCSHR_VERSION_CONCEPT));
  const versionOnly = version !== undefined ? { version } : {};
  const row = (state: OcshrState, resultText: string, statusLine: string): SignalDetails["ocshr"] => ({
    state,
    resultText,
    statusLine,
    ...versionOnly,
    ...(state === "scored" && probability !== undefined && { probability }),
  });

  if (failed) {
    const line = `Not scored${error ? `: ${error}` : ""}${code ? ` (${code})` : ""}`;
    return row("unavailable", "Not available", line);
  }
  if (hasResult) {
    const at = processedAt(readObs(obs, OCSHR_PROCESSED_TIME_CONCEPT));
    const yes = resultValue === OCSHR_RESULT_VALUES.highRisk;
    return row("scored", yes ? "High Risk: Yes" : "High Risk: No", at ? `Scored · ${at}` : "Scored");
  }
  if (qcFail) return row("unavailable", "Not available", "Not sent: failed the quality check");
  if (callMade === "No") return row("unavailable", "Not available", "Not sent to the model");
  if (callMade === "Yes") return row("pending", "Pending", "Sent, not yet scored");
  return row("pending", "Pending", "Not sent yet");
}

export function signalDetailsOf(screening: { observations?: Record<string, unknown> }): SignalDetails {
  const obs = screening.observations ?? {};
  const signals = signalsOf(screening);
  const opinion = deriveWorkerOpinion(obs);
  const edgeVerdict = deriveEdgeVerdict(obs);
  const flagged = flaggedOf(obs);
  const ocshr = ocshrOf(obs, signals.ocshr !== undefined, signals.ocshr);
  return {
    flw: {
      verdict: opinion === undefined ? undefined : opinion === WORKER_OPINION.suspicious ? "Suspicious" : "Non-Suspicious",
      referralRaised: readObs(obs, PLACE_OF_REFERRAL_CONCEPT) !== undefined,
    },
    edge: { verdict: edgeVerdict, ...(flagged && { flagged }) },
    ocshr,
    safetySample: ocshr.state === "scored" && classify(signals).group === "Safety sample",
  };
}
