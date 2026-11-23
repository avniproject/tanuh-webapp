import { Box, ButtonBase, type SxProps, type Theme } from "@mui/material";
import type { ReactNode } from "react";
import { CR, TONES, type Tone } from "@/theme/tokens";
import { HIGH_RISK } from "./breastConcepts";
import type { FormStatus } from "./breastList";

export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <Box
      component="span"
      sx={{
        display: "inline-block",
        px: 1.5,
        py: 0.5,
        borderRadius: CR.radius.pill,
        bgcolor: TONES[tone].bg,
        color: TONES[tone].fg,
        fontFamily: CR.font,
        fontSize: 13,
        fontWeight: 600,
        lineHeight: 1.4,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </Box>
  );
}

export function RiskPill({ risk, prefix = "" }: { risk: string | null; prefix?: string }) {
  if (!risk) return <Pill tone="idle">{prefix}No result</Pill>;
  const high = risk === HIGH_RISK;
  return (
    <Pill tone={high ? "high" : "low"}>
      {prefix}
      {high ? "High risk" : "Low risk"}
    </Pill>
  );
}

const STATUS_LABEL: Record<FormStatus, string> = {
  not_started: "Not started",
  draft: "Draft",
  submitted: "Submitted",
};
const STATUS_TONE: Record<FormStatus, Tone> = { not_started: "idle", draft: "draft", submitted: "submitted" };

export function FormStatusPill({ status }: { status: FormStatus }) {
  return <Pill tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Pill>;
}

export function Card({ children, sx }: { children: ReactNode; sx?: SxProps<Theme> }) {
  return (
    <Box
      sx={[
        { bgcolor: CR.surface, border: `1px solid ${CR.border}`, borderRadius: CR.radius.card, overflow: "hidden" },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {children}
    </Box>
  );
}

export function PillButton({
  children,
  onClick,
  variant = "outlined",
  disabled,
  type,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "outlined" | "filled";
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  const filled = variant === "filled";
  return (
    <ButtonBase
      type={type ?? "button"}
      onClick={onClick}
      disabled={disabled}
      sx={{
        px: 2.5,
        height: 42,
        borderRadius: CR.radius.pill,
        border: `1.5px solid ${CR.brand}`,
        bgcolor: filled ? CR.brand : CR.surface,
        color: filled ? "#fff" : CR.heading,
        fontFamily: CR.font,
        fontSize: 14,
        fontWeight: 600,
        whiteSpace: "nowrap",
        "&:hover": { bgcolor: filled ? CR.brandPressed : CR.navHover },
        "&:focus-visible": { outline: `2px solid ${CR.brand}`, outlineOffset: 2 },
        "&.Mui-disabled": { opacity: 0.5 },
      }}
    >
      {children}
    </ButtonBase>
  );
}
