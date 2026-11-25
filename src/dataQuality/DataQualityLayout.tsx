// The frame of the Data Quality section, inside the app's shell: the view tabs, the period
// picker, the CSV download and the guide button above the selected view, and the rulepack
// version below it.
//
// It loads DQS's dashboard context first. DQS refusing it with 401 or 403 means the user is
// in the Programme Manager group in Avni but is not one of the users DQS accepts, and the
// section says so instead of showing any view. The period picker sets the grain (week, month
// or financial year) and one of that grain's stored periods. The CSV download reads every
// worker of the selected period, a page of MAX_PAGE_SIZE at a time, and writes their stored
// scores.

import { useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { Alert, Box, CircularProgress, IconButton, Stack, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from "@mui/material";
import DownloadIcon from "@mui/icons-material/FileDownloadOutlined";
import HelpIcon from "@mui/icons-material/HelpOutline";
import { DqsError, MAX_PAGE_SIZE, dqsApi } from "./api/client";
import type { Grain, WorkerRow } from "./api/types";
import { FilterChip, PlainSelect } from "./components/ui";
import { STATUS_KEY, STATUS_LABEL, periodLabel } from "./format";
import { withPeriod } from "./navigation";
import type { View } from "./navigation";
import { DashboardProvider } from "./DashboardProvider";
import { useDashboard } from "./state";
import { DQ } from "./tokens";

const TABS: [View, string][] = [
  ["health", "Health Check"],
  ["workers", "Workers"],
  ["dimensions", "Quality Dimensions"],
  ["map", "Map"],
];

export function DataQualityLayout() {
  return (
    <DashboardProvider>
      {(loaded) => {
        if (loaded.state === "loading")
          return (
            <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
              <CircularProgress />
            </Box>
          );
        if (loaded.state === "error") {
          const error = loaded.error;
          if (error instanceof DqsError && (error.status === 401 || error.status === 403))
            return (
              <Alert severity="warning">
                The data quality service does not accept your account, so Data Quality can't be shown. Ask your
                administrator to add you to the data quality service's users.
              </Alert>
            );
          if (error instanceof DqsError && error.status === 503)
            return <Alert severity="info">The data quality service has no scores to serve yet ({error.message}).</Alert>;
          return <Alert severity="error">Could not reach the data quality service: {error.message}</Alert>;
        }
        return <Frame />;
      }}
    </DashboardProvider>
  );
}

function Frame() {
  const { context, grain, span, spans, select } = useDashboard();
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const [downloading, setDownloading] = useState(false);
  const view = pathname.split("/").pop() as View;
  const packs = [...new Set(context.scored_under.map((one) => String(one.rulepack_version ?? one.rulepack_id)))];

  const download = async () => {
    if (!span) return;
    setDownloading(true);
    try {
      await downloadCsv(context.tenant, grain, span.start);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Stack spacing={2}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" useFlexGap spacing={1.5}>
        <Stack direction="row" spacing={{ xs: 1, sm: 2 }} useFlexGap flexWrap="wrap" role="tablist" aria-label="Views">
          {TABS.map(([target, label]) => (
            <FilterChip key={target} label={label} selected={view === target}
              onClick={() => navigate(withPeriod(target, search))} />
          ))}
        </Stack>
        <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
          {span && (
            <PlainSelect
              label="Period"
              value={span.start}
              onChange={(start) => select(grain, start)}
              options={spans.map((one, i) => ({ value: one.start, label: `${periodLabel(grain, one)}${i === 0 ? " (latest)" : ""}` }))}
            />
          )}
          <ToggleButtonGroup
            exclusive
            size="small"
            value={grain}
            onChange={(_, next: Grain | null) => next && select(next)}
            aria-label="Grain"
            sx={{
              bgcolor: DQ.segment,
              "& .MuiToggleButton-root": { border: 0, px: 2, textTransform: "none", color: DQ.textMuted },
              "& .Mui-selected, & .Mui-selected:hover": { bgcolor: `${DQ.brand} !important`, color: "#fff !important" },
            }}
          >
            <ToggleButton value="week">Week</ToggleButton>
            <ToggleButton value="month">Month</ToggleButton>
            <ToggleButton value="year">Year</ToggleButton>
          </ToggleButtonGroup>
          <Tooltip title="Download this period's worker scores (CSV)">
            <span>
              <IconButton aria-label="Download this period's worker scores as CSV" disabled={!span || downloading} onClick={download}>
                <DownloadIcon />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="How to read this">
            <IconButton aria-label="How to read this" onClick={() => navigate(withPeriod("guide", search))}>
              <HelpIcon />
            </IconButton>
          </Tooltip>
        </Stack>
      </Stack>
      <Box sx={{ minWidth: 0 }}>
        <Outlet />
      </Box>
      <Typography variant="caption" sx={{ color: DQ.textSubtle }}>
        {packs.length ? `Rulepack version${packs.length > 1 ? "s" : ""} ${packs.join(", ")} · ` : ""}tenant {context.tenant}.
      </Typography>
    </Stack>
  );
}

async function downloadCsv(tenant: string, grain: Grain, start: string) {
  const rows: WorkerRow[] = [];
  for (let page = 1; ; page++) {
    const found = await dqsApi.workers(grain, start, { page, pageSize: MAX_PAGE_SIZE });
    rows.push(...found.workers);
    if (rows.length >= found.total || !found.workers.length) break;
  }
  const quote = (value: unknown) => {
    const text = value == null ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const scale = (row: WorkerRow, key: "trust" | "sufficiency" | "provenance_confidence" | "quality") =>
    !row.insufficient && row[key] ? row[key]!.scale.toFixed(2) : "";
  const lines = [
    [
      "worker_id", "name", "village", "taluk", "records", "dq_score", "sufficiency",
      "provenance_confidence", "fabrication_suspicion", "fidelity", "status",
    ].join(","),
    ...rows.map((row) =>
      [
        row.worker_id,
        row.name,
        row.village_name,
        row.taluk_name,
        row.n_records,
        scale(row, "trust"),
        scale(row, "sufficiency"),
        scale(row, "provenance_confidence"),
        !row.insufficient && row.fabrication_suspicion ? row.fabrication_suspicion.score.toFixed(0) : "",
        scale(row, "quality"),
        row.status ? STATUS_LABEL[STATUS_KEY[row.status]] : "",
      ]
        .map(quote)
        .join(","),
    ),
  ];
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([`${lines.join("\n")}\n`], { type: "text/csv" }));
  link.download = `${tenant}-workers-${grain}-${start}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
}
