import { Box, Tooltip, Typography } from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import type { SvgIconComponent } from "@mui/icons-material";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import WarningAmberOutlinedIcon from "@mui/icons-material/WarningAmberOutlined";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import RemoveCircleOutlineIcon from "@mui/icons-material/RemoveCircleOutline";
import {
  AI_RISK_VALUES,
  DATA_QUALITY_VALUES,
  aiRiskDisplayState,
  type AiRiskValue,
} from "@/constants/tanuhConcepts";

// PE-96 status pills for the backend-stamped Data Quality / AI Risk Assessment
// values. Colour + icon + text (never colour alone); red is reserved for High
// Risk. Tooltip copy is Fathima's prototype (PE-96 attachment) verbatim.

type Tone = "good" | "caution" | "concern" | "neutral";

const TONE_ICON: Record<Tone, SvgIconComponent> = {
  good: CheckCircleOutlineIcon,
  caution: WarningAmberOutlinedIcon,
  concern: ErrorOutlineIcon,
  neutral: RemoveCircleOutlineIcon,
};

const TIP = {
  pass: "Image and metadata checks passed. Encounter is suitable for AI pre-screening.",
  fail: "One or more image or metadata checks failed. AI risk is not generated for failed encounters.",
  notAssessed: "Not assessed — data quality did not pass, so no risk signal is produced.",
  unknown: "Value not recognised by this build of the app; shown as stored.",
  "High Risk":
    "Model flags features associated with a higher likelihood of a suspicious lesion. Prioritise clinician review.",
  "Low Risk": "Some features of interest with a lower likelihood. Routine clinician review.",
  "Non Suspicious": "No concerning features detected by the model.",
} as const;

const RISK_TONE: Record<AiRiskValue, Tone> = {
  [AI_RISK_VALUES.highRisk]: "concern",
  [AI_RISK_VALUES.lowRisk]: "caution",
  [AI_RISK_VALUES.nonSuspicious]: "good",
};

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
    <Tooltip title={tooltip} arrow enterTouchDelay={0}>
      <Box
        component="span"
        data-testid={testId}
        data-state={state}
        tabIndex={0}
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

function toneKey(tone: Exclude<Tone, "neutral">): "success" | "warning" | "error";
function toneKey(tone: Tone): "success" | "warning" | "error" | "grey";
function toneKey(tone: Tone) {
  return tone === "good" ? "success" : tone === "caution" ? "warning" : tone === "concern" ? "error" : "grey";
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

export function DataQualityBadge({ value }: { value: string | undefined }) {
  if (value === undefined) return <Dash />;
  if (value === DATA_QUALITY_VALUES.pass)
    return <StatusBadge tone="good" label="Pass" tooltip={TIP.pass} testId="data-quality-badge" state="pass" />;
  if (value === DATA_QUALITY_VALUES.fail)
    return <StatusBadge tone="caution" label="Fail" tooltip={TIP.fail} testId="data-quality-badge" state="fail" />;
  return <StatusBadge tone="neutral" label={value} tooltip={TIP.unknown} testId="data-quality-badge" state="unknown" />;
}

export function AiRiskBadge({
  dataQuality,
  aiRisk,
}: {
  dataQuality: string | undefined;
  aiRisk: string | undefined;
}) {
  const s = aiRiskDisplayState(dataQuality, aiRisk);
  switch (s.kind) {
    case "absent":
      return <Dash />;
    case "not-assessed":
      return (
        <StatusBadge
          tone="neutral"
          label="Not assessed"
          tooltip={TIP.notAssessed}
          testId="ai-risk-badge"
          state="not-assessed"
        />
      );
    case "unknown":
      return <StatusBadge tone="neutral" label={s.value} tooltip={TIP.unknown} ai testId="ai-risk-badge" state="unknown" />;
    case "value":
      return (
        <StatusBadge
          tone={RISK_TONE[s.value]}
          label={s.value}
          tooltip={TIP[s.value]}
          ai
          testId="ai-risk-badge"
          state={s.value.toLowerCase().replace(/\s+/g, "-")}
        />
      );
  }
}
