// The Map view: the taluks and their villages for the selected period, each taluk tinted by
// its DQ Score band and each village shaded by the screenings filed in it, with the pointed-at
// or selected village's screenings and workers beside the map, the taluks' scores, and a
// legend. The URL's `unit` keeps the map to one taluk and `village` holds the selected
// village.
//
// The outlines are DQS's map route, the village counts its villages route kept to the
// tenant's screening record type, the taluk bands its units route and the workers' names its
// workers route. A village's count is filed under the map village it names by id or by alias;
// counts that name a village with no outline, and screenings that name no village, are
// counted under the map and not drawn. The shades are four equal ranges up to the period's
// busiest village, so a shade means different counts in different periods.

import { Box, ButtonBase, Chip, Stack, Typography } from "@mui/material";
import { useMemo, useState } from "react";
import { DqsError, MAX_PAGE_SIZE, dqsApi } from "../api/client";
import type { MapOutlines, UnitRow, VillagesInPeriod, WorkerRow } from "../api/types";
import { Heading, Panel, Pending, PlainSelect, SectionTitle } from "../components/ui";
import { VillageMap } from "../components/VillageMap";
import { f2, int, periodLabel } from "../format";
import { useGo } from "../navigation";
import { useDashboard, useLoad, useParam, useSetParams } from "../state";
import { DQ } from "../tokens";
import { TALUK_TINT, VILLAGE_SHADES, countsByOutline, shadeOf, shadeSteps } from "../villages";
import type { TalukBand } from "../villages";

const bandOf = (unit: UnitRow | undefined): TalukBand =>
  !unit ? "none" : unit.insufficient ? "ins" : unit.trust ? unit.trust.band : "none";

const noScores = (error: unknown) => {
  if (error instanceof DqsError && error.status === 404) return null;
  throw error;
};

export function Villages() {
  const { grain, span, context } = useDashboard();
  const start = span?.start ?? "";
  const outlines = useLoad(() => dqsApi.map(), []);
  const found = useLoad(
    () =>
      Promise.all([
        dqsApi.villages(grain, start, context.screening_record_type),
        dqsApi.units(grain, start).catch(noScores),
        dqsApi.workers(grain, start, { pageSize: MAX_PAGE_SIZE }).catch(noScores),
      ]),
    [grain, start, context.screening_record_type],
    !!span,
  );
  if (!span) return <Typography sx={{ color: DQ.textSubtle }}>No scores are stored at this grain yet.</Typography>;
  return (
    <Stack spacing={2} sx={{ minWidth: 0 }}>
      <Pending loaded={outlines} reserve={{ minHeight: 600 }} empty="No village boundaries are imported for this tenant yet, so there is no map to draw.">
        {(map) => (
          <Pending loaded={found} reserve={{ minHeight: 600 }} empty={`No records are stored for ${periodLabel(grain, span)}.`}>
            {([villages, units, workers]) => (
              <Drawn map={map} villages={villages} units={units?.units ?? []} workers={workers?.workers ?? []} />
            )}
          </Pending>
        )}
      </Pending>
    </Stack>
  );
}

function Drawn({ map, villages, units, workers }: {
  map: MapOutlines;
  villages: VillagesInPeriod;
  units: UnitRow[];
  workers: WorkerRow[];
}) {
  const { grain, span, context } = useDashboard();
  const go = useGo();
  const unitParam = useParam("unit");
  const selected = useParam("village");
  const setParams = useSetParams();
  const [hovered, setHovered] = useState<string | null>(null);
  const noun = context.screening_record_type ? "screenings" : "records";

  // An unknown `unit` shows every taluk, as no `unit` does.
  const kept = useMemo(() => map.taluks.filter((one) => one.unit_id === unitParam), [map, unitParam]);
  const shown = kept.length ? kept : map.taluks;
  const shownVillages = useMemo(() => {
    const ids = new Set(shown.map((one) => one.unit_id));
    return map.villages.filter((one) => ids.has(one.taluk_id));
  }, [map, shown]);
  const filed = useMemo(() => countsByOutline(map.villages, villages.villages), [map, villages]);
  const steps = shadeSteps(Math.max(0, ...[...filed.byOutline.values()].map((one) => one.n_records)));
  const unitOf = new Map(units.map((one) => [one.unit_id, one]));
  const nameOf = new Map(workers.map((one) => [one.worker_id, one.name || one.worker_id]));
  const villageOf = new Map(map.villages.map((one) => [one.village_id, one]));
  const talukName = new Map(map.taluks.map((one) => [one.unit_id, one.name]));
  const located = shownVillages.reduce((sum, one) => sum + (filed.byOutline.get(one.village_id)?.n_records ?? 0), 0);
  const across = kept.length ? " across every taluk" : "";
  const focus = hovered ?? selected;

  return (
    <>
      <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" useFlexGap spacing={1.5}>
        <Box>
          <SectionTitle>Map</SectionTitle>
          <Typography variant="caption" sx={{ color: DQ.textMuted }}>
            {periodLabel(grain, span!)}. Each taluk is tinted by its DQ Score band. Each village is shaded by how many{" "}
            {noun} were filed in it: the shading is a count and says nothing about their quality.
          </Typography>
        </Box>
        <PlainSelect
          label="Taluk"
          value={kept.length && unitParam ? unitParam : ""}
          onChange={(value) => setParams({ unit: value || null, village: null })}
          options={[
            { value: "", label: "All taluks" },
            ...map.taluks.map((one) => ({ value: one.unit_id, label: one.name })),
          ]}
        />
      </Stack>
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "minmax(0,1fr) 320px" }, gap: 3, alignItems: "start" }}>
        <Panel sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
          <VillageMap
            taluks={shown}
            villages={shownVillages}
            bandOf={(unitId) => bandOf(unitOf.get(unitId))}
            shadeOf={(villageId) => shadeOf(filed.byOutline.get(villageId)?.n_records ?? 0, steps)}
            selected={selected}
            onHover={setHovered}
            onSelect={(villageId) => setParams({ village: villageId === selected ? null : villageId })}
            onTaluk={(unitId) => go("workers", { taluk: unitId })}
          />
          <Typography variant="caption" sx={{ color: DQ.textSubtle }}>
            {int(located)} {noun} in {periodLabel(grain, span!)} are in villages on the map.
            {filed.unmatched > 0 && ` ${int(filed.unmatched)}${across} name a village the map has no outline for.`}
            {villages.unlocated_records > 0 &&
              ` ${int(villages.unlocated_records)}${across} name no village and are not counted here.`}
          </Typography>
        </Panel>
        <Stack spacing={2}>
          <Panel>
            {focus && villageOf.has(focus) ? (
              <VillageCard
                name={villageOf.get(focus)!.name}
                villageId={focus}
                taluk={talukName.get(villageOf.get(focus)!.taluk_id) ?? null}
                count={filed.byOutline.get(focus)}
                noun={noun}
                nameOf={(id) => nameOf.get(id) ?? id}
                onWorker={(id) => go("workers", { worker: id })}
              />
            ) : (
              <Typography variant="body2" sx={{ color: DQ.textSubtle }}>
                Point at a village to see its {noun} and the workers who filed them; select it to keep it here.
              </Typography>
            )}
          </Panel>
          <Panel sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
            <Heading>Taluks</Heading>
            {map.taluks.map((one) => {
              const unit = unitOf.get(one.unit_id);
              const band = bandOf(unit);
              return (
                <ButtonBase key={one.unit_id} onClick={() => go("workers", { taluk: one.unit_id })}
                  sx={{ display: "flex", justifyContent: "space-between", px: 1, py: 1, borderRadius: 1, "&:hover": { bgcolor: DQ.surfaceSubtle } }}>
                  <Typography variant="body2">{one.name}</Typography>
                  <Typography variant="body2" sx={{ color: band === "low" ? DQ.danger : DQ.text }}>
                    {!unit ? "No records" : unit.insufficient ? "Insufficient" : unit.trust ? f2(unit.trust.scale) : "No score"}
                  </Typography>
                </ButtonBase>
              );
            })}
            <Typography variant="caption" sx={{ color: DQ.textSubtle, mt: 1 }}>Select a taluk to list its workers.</Typography>
          </Panel>
          <Panel>
            <MapLegend steps={steps} noun={noun} />
          </Panel>
        </Stack>
      </Box>
    </>
  );
}

function VillageCard({ name, villageId, taluk, count, noun, nameOf, onWorker }: {
  name: string;
  villageId: string;
  taluk: string | null;
  count: { n_records: number; workers: string[] } | undefined;
  noun: string;
  nameOf: (workerId: string) => string;
  onWorker: (workerId: string) => void;
}) {
  const { grain, span } = useDashboard();
  return (
    <Stack spacing={1}>
      <Heading>{name}</Heading>
      <Typography variant="caption" sx={{ color: DQ.textMuted }}>
        {taluk ? `${taluk} taluk · ` : ""}village {villageId}
      </Typography>
      <Typography variant="body2">
        <b>{int(count?.n_records ?? 0)}</b> {noun} in {periodLabel(grain, span!)}
      </Typography>
      {count && count.workers.length > 0 && (
        <>
          <Typography variant="caption" sx={{ color: DQ.textSubtle, textTransform: "uppercase", letterSpacing: ".8px" }}>
            Recorded by
          </Typography>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
            {count.workers.map((id) => (
              <Chip key={id} size="small" label={nameOf(id)} title={id} onClick={() => onWorker(id)}
                sx={{ bgcolor: DQ.brandSubtle, "& .MuiChip-label": { color: DQ.brand } }} />
            ))}
          </Stack>
        </>
      )}
    </Stack>
  );
}

function MapLegend({ steps, noun }: { steps: number[]; noun: string }) {
  const { context } = useDashboard();
  const settings = context.settings;
  const high = settings ? f2(settings.band_high_scale) : "High";
  const low = settings ? f2(settings.band_low_scale) : "Low";
  const swatch = (fill: string, stroke: string, dashed = false) => (
    <Box component="span" sx={{ width: 14, height: 14, flex: "none", bgcolor: fill, border: `1.5px ${dashed ? "dashed" : "solid"} ${stroke}` }} />
  );
  const item = (key: string, mark: React.ReactNode, label: string) => (
    <Stack key={key} direction="row" spacing={1} alignItems="center">
      {mark}
      <Typography variant="caption" sx={{ color: DQ.textSubtle }}>{label}</Typography>
    </Stack>
  );
  const heading = (text: string) => (
    <Typography variant="caption" sx={{ color: DQ.textSubtle, textTransform: "uppercase", letterSpacing: ".8px" }}>{text}</Typography>
  );
  const bands: [TalukBand, string][] = [
    ["high", `High ${high} and above`],
    ["mid", `Mid ${low} – ${high}`],
    ["low", `Low below ${low}`],
    ["ins", "Insufficient data"],
    ["none", "No score"],
  ];
  return (
    <Stack spacing={1}>
      {heading("Taluk: DQ Score band")}
      <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0.75 }}>
        {bands.map(([band, label]) => item(band, swatch(TALUK_TINT[band].fill, TALUK_TINT[band].stroke, TALUK_TINT[band].dashed), label))}
      </Box>
      {heading(`Village: ${noun} this period`)}
      <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0.75 }}>
        {steps.map((top, i) =>
          item(String(top), swatch(VILLAGE_SHADES[i], VILLAGE_SHADES[i]), `${int(i === 0 ? 1 : steps[i - 1] + 1)}–${int(top)}`),
        )}
        {item("none", swatch(DQ.surface, DQ.neutral), "None")}
      </Box>
    </Stack>
  );
}
