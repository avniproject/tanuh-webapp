import type { MouseEvent } from "react";
import { Box, Tooltip, Typography } from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import type { SvgIconComponent } from "@mui/icons-material";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import WarningAmberOutlinedIcon from "@mui/icons-material/WarningAmberOutlined";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import RemoveCircleOutlineIcon from "@mui/icons-material/RemoveCircleOutline";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import LockOpenOutlinedIcon from "@mui/icons-material/LockOpenOutlined";
import PersonOutlineIcon from "@mui/icons-material/PersonOutline";
import HourglassEmptyOutlinedIcon from "@mui/icons-material/HourglassEmptyOutlined";
import ScheduleOutlinedIcon from "@mui/icons-material/ScheduleOutlined";
import type { HoldStatus } from "@/api/caseHold";
import {
  MODEL_RESULT_VALUES,
  REVIEW_CATEGORY_VALUES,
  type ModelResultValue,
  type QueueGroup,
} from "@/constants/tanuhConcepts";
import { holdPill, waitingIcon, type WaitingFor, type WaitingIcon } from "./holdPill";
import { OCSHR_REASON_BADGE, type OcshrReason } from "./listReason";
import { QUEUE_GROUP_COLOURS } from "./queueGroupColours";

// Status pills for the high-risk model's values on a screening (tanuh-webapp#4). Colour + icon + text (never colour
// alone); red is reserved for High Risk. The result tooltips are Fathima's prototype copy (PE-96 attachment) verbatim.

type Tone = "good" | "caution" | "concern" | "info" | "neutral";

const TONE_ICON: Record<Tone, SvgIconComponent> = {
  good: CheckCircleOutlineIcon,
  caution: WarningAmberOutlinedIcon,
  concern: ErrorOutlineIcon,
  info: InfoOutlinedIcon,
  neutral: RemoveCircleOutlineIcon,
};

const TIP = {
  unknown: "Value not recognised by this build of the app; shown as stored.",
  "High Risk":
    "Model flags features associated with a higher likelihood of a suspicious lesion. Prioritise clinician review.",
  "Low Risk": "Some features of interest with a lower likelihood. Routine clinician review.",
  "Non Suspicious": "No concerning features detected by the model.",
} as const;

const RISK_TONE: Record<ModelResultValue, Tone> = {
  [MODEL_RESULT_VALUES.highRisk]: "concern",
  [MODEL_RESULT_VALUES.lowRisk]: "caution",
  [MODEL_RESULT_VALUES.nonSuspicious]: "good",
};

// A badge with a tooltip sits inside a list row or card that opens the case on a click. A tap on the badge shows its
// tooltip (enterTouchDelay 0) and must not open the case as well. The tooltip describes the badge rather than naming
// it, so a screen reader still reads the badge's own words.
const stopRowClick = (event: MouseEvent) => event.stopPropagation();

interface StatusBadgeProps {
  tone: Tone;
  label: string;
  tooltip: string;
  // Provenance mark: the value came from a model, not a clinician.
  ai?: boolean;
  testId: string;
  // Machine-readable state for the Playwright harness (data-state attribute).
  state: string;
}

export function StatusBadge({ tone, label, tooltip, ai, testId, state }: StatusBadgeProps) {
  const theme = useTheme();
  const main =
    tone === "neutral" ? theme.palette.grey[600] : theme.palette[toneKey(tone)].main;
  const ink = tone === "neutral" ? theme.palette.grey[800] : theme.palette[toneKey(tone)].dark;
  const Icon = TONE_ICON[tone];
  return (
    <Tooltip title={tooltip} arrow enterTouchDelay={0} describeChild>
      <Box
        component="span"
        data-testid={testId}
        data-state={state}
        tabIndex={0}
        onClick={stopRowClick}
        sx={{
          display: "inline-flex",
          alignItems: "center",
          gap: 0.5,
          px: 1,
          py: 0.25,
          borderRadius: 999,
          fontSize: "0.8rem",
          fontWeight: 600,
          lineHeight: 1.6,
          whiteSpace: "nowrap",
          color: ink,
          bgcolor: alpha(main, 0.12),
          border: `1px solid ${alpha(main, 0.45)}`,
          cursor: "default",
        }}
      >
        <Icon sx={{ fontSize: 15 }} aria-hidden />
        {label}
        {ai && <AiMark />}
      </Box>
    </Tooltip>
  );
}

function toneKey(tone: Exclude<Tone, "neutral">): "success" | "warning" | "error" | "info";
function toneKey(tone: Tone): "success" | "warning" | "error" | "info" | "grey";
function toneKey(tone: Tone) {
  return tone === "good"
    ? "success"
    : tone === "caution"
      ? "warning"
      : tone === "concern"
        ? "error"
        : tone === "info"
          ? "info"
          : "grey";
}

function AiMark() {
  return (
    <Box
      component="span"
      aria-label="AI-generated"
      sx={{
        fontSize: "0.6rem",
        fontWeight: 800,
        letterSpacing: "0.04em",
        lineHeight: 1,
        px: 0.5,
        py: 0.25,
        ml: 0.25,
        borderRadius: 0.5,
        bgcolor: "rgba(0,0,0,0.08)",
        color: "inherit",
      }}
    >
      AI
    </Box>
  );
}

// Plain dash for "nothing recorded" — deliberately not a badge, so an old
// screening does not read as if it failed a check.
function Dash() {
  return (
    <Typography component="span" color="text.secondary">
      —
    </Typography>
  );
}

const CATEGORY_TONE: Record<string, Tone> = {
  [REVIEW_CATEGORY_VALUES.highRisk]: "concern",
  [REVIEW_CATEGORY_VALUES.flwOverride]: "caution",
  [REVIEW_CATEGORY_VALUES.lowRisk]: "caution",
  [REVIEW_CATEGORY_VALUES.notScored]: "neutral",
  [REVIEW_CATEGORY_VALUES.safetySample]: "info",
  [REVIEW_CATEGORY_VALUES.closed]: "good",
};
const CATEGORY_TIP: Record<string, string> = {
  [REVIEW_CATEGORY_VALUES.highRisk]: "The model rated this case high risk.",
  [REVIEW_CATEGORY_VALUES.flwOverride]: "The model found nothing suspicious, but the health worker marked a photo suspicious.",
  [REVIEW_CATEGORY_VALUES.lowRisk]: "The model rated this case low risk.",
  [REVIEW_CATEGORY_VALUES.notScored]: "No model result: the screening has no photo.",
  [REVIEW_CATEGORY_VALUES.safetySample]: "Cleared by the model and the worker, and picked at random for a check.",
  [REVIEW_CATEGORY_VALUES.closed]: "Cleared by the model and the worker; not sent for review.",
};

// The review group the model's job set on the screening.
export function CategoryBadge({ value }: { value: string | undefined }) {
  if (value === undefined) return <Dash />;
  return (
    <StatusBadge
      tone={CATEGORY_TONE[value] ?? "neutral"}
      label={value}
      tooltip={CATEGORY_TIP[value] ?? TIP.unknown}
      testId="review-category-badge"
      state={value.toLowerCase().replace(/\s+/g, "-")}
    />
  );
}

// The model's own result, marked as AI.
export function ModelResultBadge({ value }: { value: string | undefined }) {
  if (value === undefined) return <Dash />;
  const known = (Object.values(MODEL_RESULT_VALUES) as string[]).includes(value);
  return (
    <StatusBadge
      tone={known ? RISK_TONE[value as ModelResultValue] : "neutral"}
      label={value}
      tooltip={known ? TIP[value as ModelResultValue] : TIP.unknown}
      ai
      testId="model-result-badge"
      state={value.toLowerCase().replace(/\s+/g, "-")}
    />
  );
}

// A plain pill: text on a pale fill of its own colour, so the label carries the meaning and the colour only groups it.
// It never wraps; an icon, when given, goes before the text.
function Pill({ label, ink, fill, testId, state, icon: Icon }: {
  label: string;
  ink: string;
  fill: string;
  testId: string;
  state: string;
  icon?: SvgIconComponent;
}) {
  return (
    <Box
      component="span"
      data-testid={testId}
      data-state={state}
      sx={{
        display: Icon ? "inline-flex" : "inline-block",
        alignItems: "center",
        gap: 0.5,
        px: 1,
        py: 0.25,
        borderRadius: 999,
        fontSize: "0.8rem",
        fontWeight: 600,
        lineHeight: 1.6,
        color: ink,
        bgcolor: fill,
        whiteSpace: "nowrap",
      }}
    >
      {Icon && <Icon sx={{ fontSize: 14 }} aria-hidden />}
      {label}
    </Box>
  );
}

export function QueueGroupBadge({ value }: { value: QueueGroup }) {
  const { ink, fill } = QUEUE_GROUP_COLOURS[value];
  return (
    <Pill
      label={value}
      ink={ink}
      fill={fill}
      testId="queue-group-badge"
      state={value.toLowerCase().replace(/\s+/g, "-")}
    />
  );
}

// A listed case that is not handed out for want of an OCSHR result (PE-249): a quiet grey pill with an hourglass. It
// reads "OCSHR not scored", with a no-result mark in place of the hourglass, for a case the OCSHR model will never
// score, which is not pending.
export function OcshrPendingBadge({ label = "OCSHR pending" }: { label?: OcshrReason }) {
  const { testId, icon } = OCSHR_REASON_BADGE[label];
  return (
    <Pill
      label={label}
      ink="#475569"
      fill="#f1f5f9"
      icon={icon === "hourglass" ? HourglassEmptyOutlinedIcon : RemoveCircleOutlineIcon}
      testId={testId}
      state={label.toLowerCase().replace(/\s+/g, "-")}
    />
  );
}

const WAITING_ICONS: Record<WaitingIcon, SvgIconComponent> = {
  "open-lock": LockOpenOutlinedIcon,
  clock: ScheduleOutlinedIcon,
  "no-result": RemoveCircleOutlineIcon,
};

const HOLD_PILL: Record<HoldStatus["kind"], { ink: string; fill: string; icon: SvgIconComponent }> = {
  waiting: { ink: "#475569", fill: "#f1f5f9", icon: LockOpenOutlinedIcon },
  mine: { ink: "#1d4ed8", fill: "#dbeafe", icon: PersonOutlineIcon },
  other: { ink: "#b91c1c", fill: "#fee2e2", icon: LockOutlinedIcon },
};

// Who is working on a case right now, on one line. Another physician is named without the organisation's
// `usernameSuffix`; the tooltip gives their full username and when they took the case. A case waiting for its OCSHR
// result cannot be taken yet, so it shows a clock in place of the open lock; one the OCSHR model will never score shows
// a no-result mark. `withSince` (the case page's header) adds the time the viewer took their own case.
export function HoldStatusBadge({
  status,
  usernameSuffix,
  waitingFor = "review",
  withSince = false,
}: {
  status: HoldStatus;
  usernameSuffix?: string;
  waitingFor?: WaitingFor;
  withSince?: boolean;
}) {
  const { label, tooltip } = holdPill(status, usernameSuffix, { waitingFor, withSince });
  const { ink, fill } = HOLD_PILL[status.kind];
  const icon = status.kind === "waiting" ? WAITING_ICONS[waitingIcon(waitingFor)] : HOLD_PILL[status.kind].icon;
  const pill = <Pill label={label} ink={ink} fill={fill} icon={icon} testId="hold-status" state={status.kind} />;
  if (!tooltip) return pill;
  // The tooltip needs an element that takes its ref and handlers, which Pill does not.
  return (
    <Tooltip title={tooltip} arrow enterTouchDelay={0} describeChild>
      <Box component="span" tabIndex={0} onClick={stopRowClick} sx={{ display: "inline-flex" }}>
        {pill}
      </Box>
    </Tooltip>
  );
}
