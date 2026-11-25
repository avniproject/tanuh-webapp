// The district's taluks as a map, with a marker on each coloured by the taluk's DQ Score band
// for the period. Pointing at a marker shows the taluk's score and its workers by band;
// selecting it calls `onTaluk`, which the Health Check uses to open the Workers view filtered
// to that taluk.
//
// The outlines are DQS's map route, the bands its units route and the workers its workers
// route. A taluk on the map with no score row for the period, or with no DQ Score, gets a
// hollow marker, as an insufficient one does; the card says which it is.

import { Box, Stack, Tooltip, Typography } from "@mui/material";
import { useMemo } from "react";
import type { MapOutlines, Settings, UnitRow, WorkerRow } from "../api/types";
import { f2 } from "../format";
import { talukShapes } from "../geo";
import { DQ } from "../tokens";
import { Dot } from "./ui";
import type { DotKind } from "./ui";

const WIDTH = 600;

type Band = "high" | "mid" | "low" | "ins" | "none";

const bandOf = (unit: UnitRow | undefined): Band =>
  !unit ? "none" : unit.insufficient ? "ins" : unit.trust ? unit.trust.band : "none";

// High is green, as in the legend under the map; the dqs-demo design drew it in the brand
// colour, which the legend did not show.
const MARKER: Record<Band, { fill: string; stroke: string; dashed: boolean }> = {
  high: { fill: DQ.success, stroke: DQ.success, dashed: false },
  mid: { fill: DQ.neutral, stroke: DQ.neutral, dashed: false },
  low: { fill: DQ.danger, stroke: DQ.danger, dashed: false },
  ins: { fill: DQ.surface, stroke: DQ.borderStrong, dashed: true },
  none: { fill: DQ.surface, stroke: DQ.borderStrong, dashed: true },
};

// A worker's dot in the card, coloured as the legend under the map colours bands.
const workerDot = (row: WorkerRow): DotKind =>
  row.insufficient || !row.trust ? "ins" : row.trust.band === "high" ? "success" : row.trust.band;

function Card({ name, unit, workers, settings }: {
  name: string;
  unit: UnitRow | undefined;
  workers: WorkerRow[];
  settings: Settings | null;
}) {
  const band = bandOf(unit);
  const low = settings ? f2(settings.band_low_scale) : "the Low threshold";
  const high = settings ? f2(settings.band_high_scale) : "the High threshold";
  const figure = !unit ? "No records" : unit.insufficient ? "Insufficient" : unit.trust ? f2(unit.trust.scale) : "Not measured";
  const bandText = { low: `Low · below ${low}`, mid: `Mid · ${low} to ${high}`, high: `High · ${high} and above` }[
    band as "low" | "mid" | "high"
  ];
  const count = (kind: DotKind) => workers.filter((row) => workerDot(row) === kind).length;
  return (
    <Stack spacing={0.5} sx={{ minWidth: 200, color: DQ.text }}>
      <Stack direction="row" justifyContent="space-between" spacing={2}>
        <Typography sx={{ fontWeight: 500 }}>{name}</Typography>
        <Typography sx={{ fontWeight: 500, color: band === "low" ? DQ.danger : DQ.text }}>{figure}</Typography>
      </Stack>
      {bandText && (
        <Typography variant="caption" sx={{ color: band === "low" ? DQ.danger : DQ.textMuted }}>
          DQ Score {bandText}
        </Typography>
      )}
      <Typography variant="caption" sx={{ color: DQ.textMuted }}>
        {workers.length} worker{workers.length === 1 ? "" : "s"} · {count("success")} High · {count("low")} Low
      </Typography>
      <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
        {workers.map((row) => (
          <Dot key={`${row.worker_id}-${row.peer_group_key}`} kind={workerDot(row)} title={row.name || row.worker_id} />
        ))}
      </Stack>
    </Stack>
  );
}

export function TalukMap({ outlines, units, workers, settings, onTaluk }: {
  outlines: MapOutlines;
  units: UnitRow[];
  workers: WorkerRow[];
  settings: Settings | null;
  onTaluk: (unitId: string) => void;
}) {
  const shapes = useMemo(() => talukShapes(outlines.taluks, WIDTH), [outlines]);
  const unitOf = new Map(units.map((one) => [one.unit_id, one]));
  const workersOf = (unitId: string) => workers.filter((row) => row.taluk_id === unitId);
  const r = Math.max(12, Math.min(shapes.width, shapes.height) * 0.03);
  const pad = r * 3;
  return (
    <Box sx={{ display: "flex", justifyContent: "center", minHeight: 300 }}>
      <Box
        component="svg"
        viewBox={`${-pad} ${-pad} ${shapes.width + 2 * pad} ${shapes.height + 2 * pad}`}
        role="img"
        aria-label="Map of the taluks, with a marker for each coloured by its DQ Score band"
        sx={{ width: "100%", height: "auto", maxHeight: 480, display: "block", overflow: "visible" }}
      >
        {shapes.taluks.map((one) => (
          <path key={one.unitId} d={one.d} fill={DQ.brandSubtleHover} stroke={DQ.surface} strokeWidth={1.5}
            strokeLinejoin="round" />
        ))}
        {shapes.taluks.map((one) => {
          if (!one.label) return null;
          const [x, y] = one.label;
          const marker = MARKER[bandOf(unitOf.get(one.unitId))];
          return (
            <g key={one.unitId}>
              <Tooltip
                arrow
                placement="top"
                componentsProps={{ tooltip: { sx: { bgcolor: DQ.surface, boxShadow: 3, p: 1.5, maxWidth: 320 } } }}
                title={<Card name={one.name} unit={unitOf.get(one.unitId)} workers={workersOf(one.unitId)} settings={settings} />}
              >
                <Box
                  component="circle"
                  cx={x}
                  cy={y}
                  r={r}
                  fill={marker.fill}
                  stroke={marker.stroke}
                  strokeWidth={marker.dashed ? 2 : 0}
                  strokeDasharray={marker.dashed ? "3 3" : undefined}
                  tabIndex={0}
                  role="button"
                  aria-label={`${one.name}: open its workers`}
                  onClick={() => onTaluk(one.unitId)}
                  onKeyDown={(event: React.KeyboardEvent) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onTaluk(one.unitId);
                    }
                  }}
                  sx={{ cursor: "pointer", outline: "none", "&:hover, &:focus-visible": { stroke: DQ.text, strokeWidth: 3 } }}
                />
              </Tooltip>
              <text x={x} y={y + r * 2.5} textAnchor="middle" fontSize={r * 1.25} fill={DQ.brandPressed}
                style={{ pointerEvents: "none", letterSpacing: 0.3 }}>
                {one.name}
              </text>
            </g>
          );
        })}
      </Box>
    </Box>
  );
}
