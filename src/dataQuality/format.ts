// Labels and number formats shared by the views. Nothing here computes a score: each
// function formats a stored value or names one.

import type { Feeds, GateScore, Grain, Span, Status } from "@/dataQuality/api/types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const parts = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
};

export const dayMonth = (iso: string) => {
  const { m, d } = parts(iso);
  return `${d} ${MONTHS[m - 1]}`;
};

// A period's name in the period picker and in sentences: "Week of 16 Mar – 22 Mar 2026",
// "March 2026" or "FY 2026–27".
export function periodLabel(grain: Grain, span: Span): string {
  const start = parts(span.start);
  if (grain === "week") return `Week of ${dayMonth(span.start)} – ${dayMonth(span.end)} ${parts(span.end).y}`;
  if (grain === "month") return `${MONTHS_LONG[start.m - 1]} ${start.y}`;
  return `FY ${start.y}–${String(start.y + 1).slice(2)}`;
}

// A period named by its start alone: "Week of 16 Mar", "March 2026" or "FY 2026–27".
export function periodShort(grain: Grain, start: string): string {
  return grain === "week" ? `Week of ${dayMonth(start)}` : periodLabel(grain, { start, end: start });
}

export const PERIOD_NOUN: Record<Grain, string> = { week: "Week", month: "Month", year: "Year" };

export const int = (x: number | null | undefined) =>
  x == null ? "—" : Math.round(x).toLocaleString("en-IN");
export const pct = (x: number | null | undefined, digits = 1) =>
  x == null ? "—" : `${(x * 100).toFixed(digits)}%`;
export const f2 = (x: number | null | undefined) => (x == null ? "—" : x.toFixed(2));

// The design groups the four gates under three headings. Genuineness shows provenance
// confidence, with fabrication suspicion beside it: the two are never combined.
export type GateGroup = "Sufficiency" | "Genuineness" | "Fidelity";
export const GATE_GROUP: Record<Feeds, GateGroup> = {
  sufficiency: "Sufficiency",
  provenance: "Genuineness",
  suspicion: "Genuineness",
  quality: "Fidelity",
};
export const GROUP_FEEDS: Record<GateGroup, Feeds[]> = {
  Sufficiency: ["sufficiency"],
  Genuineness: ["provenance", "suspicion"],
  Fidelity: ["quality"],
};
export const QUESTION: Record<GateGroup, string> = {
  Sufficiency: "Is everything required present?",
  Genuineness: "Was it really captured, here, now?",
  Fidelity: "Is the capture technically usable?",
};

const DIMENSION_NAMES: Record<string, string> = {
  "sufficiency.protocol": "Protocol completeness",
  "sufficiency.multi_modality": "Images captured",
  "genuineness.provenance": "Field capture evidence",
  "genuineness.fabrication": "Fabrication signals",
  "quality.conformance": "Conformance",
  "quality.consistency": "Consistency",
  "quality.accuracy": "Agreement with AI and clinician",
  "quality.plausibility": "Plausibility",
};
export function dimensionName(id: string): string {
  if (DIMENSION_NAMES[id]) return DIMENSION_NAMES[id];
  const last = id.split(".").pop()!.replace(/_/g, " ");
  return last.charAt(0).toUpperCase() + last.slice(1);
}

// A rule id without its tenant prefix: "samvit:ORAL-006" is shown as "ORAL-006".
export const shortId = (id: string) => id.replace(/^[a-z]+:/, "");

export type StatusKey = "low" | "high" | "slip" | "ins";
export const STATUS_KEY: Record<Status, StatusKey> = {
  consistently_low: "low",
  consistently_high: "high",
  recent_slip: "slip",
  insufficient: "ins",
};
export const STATUS_OF_KEY: Record<StatusKey, Status> = {
  low: "consistently_low",
  high: "consistently_high",
  slip: "recent_slip",
  ins: "insufficient",
};
export const STATUS_LABEL: Record<StatusKey, string> = {
  low: "Consistently Low",
  high: "Consistently High",
  slip: "Recent Slip",
  ins: "Insufficient",
};

// A gate's value on the 1-5 scale, or the word for why there is none.
export const gateText = (x: GateScore | null, insufficient: boolean) =>
  insufficient ? "—" : x ? f2(x.scale) : "Not measured";

// Fabrication suspicion as it is shown beside Genuineness: on 0-100, lower is better.
export const suspicionText = (x: GateScore | null) =>
  x ? `Fabrication suspicion ${x.score.toFixed(0)}/100` : null;

// Where a worker is, as "village, taluk", for the tables.
export const place = (row: { village_name: string | null; taluk_name: string | null }) =>
  [row.village_name, row.taluk_name].filter(Boolean).join(", ") || "No village on file";
