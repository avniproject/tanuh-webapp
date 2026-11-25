// The small pieces every Data Quality view uses, in Material UI: band dots, the status pill,
// the change marker on a KPI card, the DQ score and gate cells, a reason card, the band
// legend, filter chips, a panel, a clickable table row, a select styled as in the design, and
// what a panel shows while its data loads.

import type { ReactNode } from "react";
import {
  Box,
  ButtonBase,
  Chip,
  CircularProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  TableRow,
  Typography,
} from "@mui/material";
import type { SxProps, Theme } from "@mui/material";
import ArrowDropUpIcon from "@mui/icons-material/ArrowDropUp";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import { DqsError } from "../api/client";
import type { GateScore, Settings } from "../api/types";
import { STATUS_LABEL, capitalised, f2, int } from "../format";
import type { StatusKey } from "../format";
import type { Loaded } from "../state";
import { DQ } from "../tokens";

export type DotKind = "success" | "high" | "low" | "mid" | "ins";
const DOT_FILL: Record<DotKind, string> = {
  success: DQ.success,
  high: DQ.brand,
  low: DQ.danger,
  mid: DQ.neutral,
  ins: DQ.surface,
};

export function Dot({ kind, size = 12, title }: { kind: DotKind; size?: number; title?: string }) {
  return (
    <Box
      component="span"
      title={title}
      aria-hidden={title ? undefined : true}
      sx={{
        display: "inline-block",
        flex: "none",
        width: size,
        height: size,
        borderRadius: "50%",
        bgcolor: DOT_FILL[kind],
        border: kind === "ins" ? `1.5px dashed ${DQ.borderStrong}` : "none",
        boxSizing: "border-box",
      }}
    />
  );
}

const PILL: Record<StatusKey, { bg: string; fg: string }> = {
  low: { bg: DQ.dangerSubtle, fg: DQ.danger },
  high: { bg: DQ.brandSubtle, fg: DQ.brand },
  slip: { bg: DQ.warningSubtle, fg: DQ.warning },
  ins: { bg: DQ.surfaceDisabled, fg: DQ.textMuted },
};

export function StatusPill({ status }: { status: StatusKey | null }) {
  if (!status)
    return (
      <Typography variant="caption" sx={{ color: DQ.textDisabled, whiteSpace: "nowrap" }}>
        No status
      </Typography>
    );
  return (
    <Chip
      size="small"
      label={STATUS_LABEL[status]}
      sx={{ bgcolor: PILL[status].bg, "& .MuiChip-label": { color: PILL[status].fg, fontWeight: 400 } }}
    />
  );
}

// The change since the previous period on a KPI card. `goodUp` colours it: true when a rise
// is good, false when a fall is, null when neither.
export function Change({
  delta,
  goodUp,
  format,
  noun,
}: {
  delta: number | null;
  goodUp: boolean | null;
  format: (x: number) => string;
  noun: string;
}) {
  const sx = { fontSize: 11, color: DQ.textDisabled, display: "flex", alignItems: "center", gap: 0.25 };
  if (delta == null || !isFinite(delta)) return <Box sx={sx}>No previous {noun.toLowerCase()}</Box>;
  if (Math.abs(delta) < 5e-4) return <Box sx={sx}>No change vs Previous {noun}</Box>;
  const colour = goodUp == null ? DQ.textDisabled : delta > 0 === goodUp ? DQ.successText : DQ.danger;
  const Arrow = delta > 0 ? ArrowDropUpIcon : ArrowDropDownIcon;
  return (
    <Box sx={sx}>
      <Arrow sx={{ color: colour, fontSize: 18, ml: -0.5 }} />
      {format(Math.abs(delta))} vs Previous {noun}
    </Box>
  );
}

// A DQ score (TrustIndex) with an arrow for its change on the previous scored period. The
// arrow compares two stored scores; it computes none.
export function TrustCell({
  trust,
  previous,
  insufficient,
}: {
  trust: GateScore | null;
  previous?: GateScore | null;
  insufficient: boolean;
}) {
  if (insufficient) return <Muted>Insufficient</Muted>;
  if (!trust) return <Muted>Not measured</Muted>;
  const change = previous && Math.abs(trust.scale - previous.scale) >= 5e-4 ? trust.scale - previous.scale : 0;
  return (
    <Box component="span" sx={{ display: "inline-flex", alignItems: "center", whiteSpace: "nowrap", verticalAlign: "middle", ml: "-20px" }}>
      {change > 0 ? (
        <ArrowDropUpIcon fontSize="small" sx={{ my: -0.5 }} aria-label="up" />
      ) : change < 0 ? (
        <ArrowDropDownIcon fontSize="small" sx={{ my: -0.5, color: DQ.danger }} aria-label="down" />
      ) : (
        <Box component="span" sx={{ width: 20 }} />
      )}
      {f2(trust.scale)}
    </Box>
  );
}

export function GateCell({ gate, insufficient }: { gate: GateScore | null; insufficient: boolean }) {
  if (insufficient) return <Muted>—</Muted>;
  if (!gate) return <Muted>Not measured</Muted>;
  return <>{f2(gate.scale)}</>;
}

export const Muted = ({ children }: { children: ReactNode }) => (
  <Box component="span" sx={{ color: DQ.textDisabled }}>
    {children}
  </Box>
);

export function ReasonCard({
  title,
  group,
  records,
  noun = "records",
  rate,
  tooltip,
  onClick,
}: {
  title: string;
  group: string;
  records: number;
  // What the records the rule checked are called, such as "photos".
  noun?: string;
  rate: number | null;
  tooltip?: string;
  onClick?: () => void;
}) {
  return (
    <ButtonBase
      title={tooltip}
      onClick={onClick}
      sx={{
        display: "grid",
        gridTemplateColumns: "minmax(0,1fr) auto",
        gap: 1,
        alignItems: "center",
        width: "100%",
        textAlign: "left",
        bgcolor: DQ.surface,
        borderRadius: 1,
        p: 1,
        "&:hover": { bgcolor: DQ.surfaceSubtle },
      }}
    >
      <Box>
        <Typography variant="body2" sx={{ wordBreak: "break-word" }}>
          {title}
        </Typography>
        <Typography sx={{ fontSize: 10, color: DQ.textSubtle }}>
          {group} • {int(records)} {capitalised(noun)}
        </Typography>
      </Box>
      <Box sx={{ borderLeft: `1px solid ${DQ.border}`, pl: 1, minWidth: 58, color: DQ.danger }}>
        <Typography component="span" sx={{ fontSize: 22, fontWeight: 300, lineHeight: "28px" }}>
          {rate == null ? "—" : (rate * 100).toFixed(1)}
        </Typography>
        <Typography component="sup" sx={{ fontSize: 10, color: DQ.textSubtle }}>
          {rate == null ? "" : "%"}
        </Typography>
        <Typography sx={{ fontSize: 10 }}>Failure</Typography>
      </Box>
    </ButtonBase>
  );
}

export function Legend({ settings, withMid }: { settings: Settings | null; withMid: boolean }) {
  const high = settings ? f2(settings.band_high_scale) : "the High threshold";
  const low = settings ? f2(settings.band_low_scale) : "the Low threshold";
  const items: [DotKind, string][] = [
    ["success", `High ${high} and above`],
    ["low", `Low below ${low}`],
    ...(withMid ? ([["mid", `Mid ${low} – ${high}`], ["ins", "Insufficient data"]] as [DotKind, string][]) : []),
  ];
  return (
    <Stack direction="row" spacing={2} useFlexGap flexWrap="wrap" alignItems="center">
      {items.map(([kind, label]) => (
        <Stack key={label} direction="row" spacing={1} alignItems="center">
          <Dot kind={kind} size={16} />
          <Typography variant="caption" sx={{ color: DQ.textSubtle }}>
            {label}
          </Typography>
        </Stack>
      ))}
    </Stack>
  );
}

// A filter chip: the brand tint, filled when selected.
export function FilterChip({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <Chip
      label={label}
      clickable
      onClick={onClick}
      aria-pressed={selected}
      sx={{
        height: 40,
        px: 1,
        borderRadius: 999,
        bgcolor: selected ? DQ.brand : DQ.brandSubtle,
        "& .MuiChip-label": { color: selected ? "#fff" : DQ.brand, fontWeight: selected ? 500 : 400, fontSize: 13 },
        "&:hover": { bgcolor: selected ? DQ.brand : DQ.brandSubtleHover },
      }}
    />
  );
}

export function Panel({ children, sx }: { children: ReactNode; sx?: SxProps<Theme> }) {
  return (
    <Paper elevation={0} sx={[{ p: 2, borderRadius: 2, minWidth: 0 }, ...(Array.isArray(sx) ? sx : [sx])]}>
      {children}
    </Paper>
  );
}

// A table row that opens something when clicked, or when Enter or Space is pressed on it.
export function ClickRow({
  selected,
  onOpen,
  children,
}: {
  selected?: boolean;
  onOpen: () => void;
  children: ReactNode;
}) {
  return (
    <TableRow
      hover
      selected={selected}
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      sx={{ cursor: "pointer", "&.Mui-selected, &.Mui-selected:hover": { bgcolor: DQ.brandSubtle } }}
    >
      {children}
    </TableRow>
  );
}

// The table styling the design uses: small text, light rules, no outer border.
export const TABLE_SX = {
  "& th": { color: DQ.textSubtle, fontWeight: 400, fontSize: 12, whiteSpace: "nowrap", py: 2, pl: 0, pr: 1 },
  "& td": { fontSize: 12, py: 1.5, pl: 0, pr: 1, borderColor: DQ.border },
  "& th:last-of-type, & td:last-of-type": { pr: 0 },
} as const;

// A select styled as in the design: the value in the brand colour, no outline.
export function PlainSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <Select
      variant="standard"
      disableUnderline
      value={value}
      onChange={(event) => onChange(event.target.value)}
      inputProps={{ "aria-label": label }}
      displayEmpty
      sx={{ color: DQ.brandPressed, fontWeight: 500, fontSize: 16, "& .MuiSelect-select": { py: 0.75, pl: 1 } }}
    >
      {options.map((option) => (
        <MenuItem key={option.value} value={option.value}>
          {option.label}
        </MenuItem>
      ))}
    </Select>
  );
}

// What a panel shows while its data loads, when DQS has nothing stored for the period, and
// when the call failed.
export function Pending<T>({
  loaded,
  empty,
  children,
}: {
  loaded: Loaded<T>;
  empty?: string;
  children: (value: T) => ReactNode;
}) {
  if (loaded.state === "loading") return <CircularProgress size={20} />;
  if (loaded.state === "error") {
    const error = loaded.error;
    if (error instanceof DqsError && error.status === 404)
      return <Typography variant="body2" sx={{ color: DQ.textSubtle }}>{empty ?? "Nothing is stored for this period."}</Typography>;
    return <Typography variant="body2" color="error">Could not load this: {error.message}</Typography>;
  }
  return <>{children(loaded.value)}</>;
}

export const Heading = ({ children }: { children: ReactNode }) => (
  <Typography sx={{ m: 0, fontSize: 22, lineHeight: "28px", fontWeight: 400 }}>{children}</Typography>
);

export const SectionTitle = ({ children }: { children: ReactNode }) => (
  <Typography sx={{ m: 0, fontSize: 16, lineHeight: "24px", fontWeight: 500 }}>{children}</Typography>
);
