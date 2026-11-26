// The Health Check view: the period's four KPIs with their change since the period before,
// the workers who could not be scored, the period's screenings day by day, the workers by
// taluk, and the top three reasons for poor quality across all workers.
//
// The workers by taluk are a map or a list, chosen by the URL's `layout` (`list`, or the map
// by default). The map draws the taluks from DQS's map route with a marker for each taluk's
// band, from the units route, and its workers from the workers route; selecting a taluk opens
// the Workers view filtered to it. The list is the five lowest and five highest DQ scores.
//
// The KPIs are the counts DQS's workers route returns for the period and the one before it.
// The daily activity is DQS's days route, counting screenings, which is what Records Assessed
// counts in practice: a worker's busiest record type other than the photos.
// The lowest and highest lists are the first five Low-band workers in ascending TrustIndex and
// the first five High-band workers in descending TrustIndex. The reasons are the period's
// rules that count towards a score, ordered by failures.

import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import {
  Box,
  Divider,
  Link,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { DqsError, MAX_PAGE_SIZE, dqsApi } from "../api/client";
import type { Grain, RuleFailures, WorkerRow, WorkersPage } from "../api/types";
import { DailyBars } from "../components/DailyBars";
import { TalukMap } from "../components/TalukMap";
import { Freshness } from "../components/Freshness";
import {
  Change,
  ClickRow,
  Heading,
  Legend,
  Panel,
  Pending,
  ReasonCard,
  SectionTitle,
  TABLE_SX,
  TrustCell,
} from "../components/ui";
import { latestDay, screenings, shownCounts } from "../days";
import {
  GATE_GROUP,
  PERIOD_NOUN,
  checkedNoun,
  dayMonth,
  dimensionName,
  f2,
  int,
  pct,
  periodLabel,
  place,
} from "../format";
import { useGo } from "../navigation";
import { workerLink } from "../rows";
import { useDashboard, useLoad, useParam, useSetParams } from "../state";
import type { Loaded } from "../state";
import { DQ } from "../tokens";

export function HealthCheck() {
  const { grain, span, context } = useDashboard();
  const go = useGo();
  const start = span?.start ?? "";
  const counts = useLoad(() => dqsApi.workers(grain, start, { pageSize: 1 }), [grain, start], !!span);
  const lowest = useLoad(
    () => dqsApi.workers(grain, start, { band: "low", order: "trust_asc", pageSize: 5 }),
    [grain, start],
    !!span,
  );
  const highest = useLoad(
    () => dqsApi.workers(grain, start, { band: "high", order: "trust_desc", pageSize: 5 }),
    [grain, start],
    !!span,
  );
  const rules = useLoad(() => dqsApi.rules(grain, start), [grain, start], !!span);
  const layout = useParam("layout") === "list" ? "list" : "map";
  const setParams = useSetParams();
  // The outlines change only with a new location version, so they are read once; the bands
  // and the workers follow the period.
  const outlines = useLoad(() => dqsApi.map(), []);
  const scored = useLoad(
    () =>
      Promise.all([
        // A period with no taluk scores still draws the map, with every marker hollow.
        dqsApi.units(grain, start).catch((error) => {
          if (error instanceof DqsError && error.status === 404) return { units: [] };
          throw error;
        }),
        dqsApi.workers(grain, start, { pageSize: MAX_PAGE_SIZE }),
      ]),
    [grain, start],
    !!span && layout === "map",
  );
  const map = both(outlines, scored, (found, [units, page]) => ({
    outlines: found,
    units: units.units,
    workers: page.workers,
  }));
  const district = context.districts.length === 1 ? context.districts[0].name : null;
  const taluks = outlines.state === "ok" ? outlines.value.taluks.length : null;

  if (!span) return <Typography sx={{ color: DQ.textSubtle }}>No scores are stored at this grain yet.</Typography>;
  const settings = context.settings;
  const noun = PERIOD_NOUN[grain].toLowerCase();
  const lowText = settings ? f2(settings.band_low_scale) : "the Low threshold";
  const highText = settings ? f2(settings.band_high_scale) : "the High threshold";

  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "1fr", lg: "minmax(0,1fr) minmax(254px,24%)" },
        gap: 2,
        alignItems: "stretch",
      }}
    >
      <Stack spacing={2} sx={{ minWidth: 0 }}>
        <SectionTitle>Program Health Check</SectionTitle>
        <Pending loaded={counts} reserve={{ minHeight: { xs: 684, sm: 352, lg: 186 } }}
          empty={`No worker scores are stored for ${periodLabel(grain, span)}.`}>
          {(page) => <Kpis page={page} grain={grain} onInsufficient={() => go("workers", { status: "ins" })} />}
        </Pending>
        <DailyActivity />
        <Panel sx={{ display: "flex", flexDirection: "column", gap: 1, flex: 1 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" useFlexGap spacing={1.5}>
            <Box>
              <Heading>{district ? `Workers in ${district}` : "Workers by Taluk"}</Heading>
              <Crumbs district={district} taluks={taluks} />
            </Box>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={layout}
              onChange={(_, next: "map" | "list" | null) => next && setParams({ layout: next === "map" ? null : next })}
              aria-label="Layout"
              sx={{
                bgcolor: DQ.segment,
                "& .MuiToggleButton-root": { border: 0, px: 2, textTransform: "none", color: DQ.textMuted },
                "& .Mui-selected, & .Mui-selected:hover": { bgcolor: `${DQ.brand} !important`, color: "#fff !important" },
              }}
            >
              <ToggleButton value="map">Map View</ToggleButton>
              <ToggleButton value="list">List View</ToggleButton>
            </ToggleButtonGroup>
          </Stack>
          {layout === "map" ? (
            <Pending loaded={map} reserve={{ minHeight: 400 }} empty="No village boundaries are imported for this tenant yet. Switch to List View to see the workers without the map.">
              {({ outlines, units, workers }) => (
                <TalukMap
                  outlines={outlines}
                  units={units}
                  workers={workers}
                  settings={settings}
                  onTaluk={(unitId) => go("workers", { taluk: unitId })}
                />
              )}
            </Pending>
          ) : (
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "1fr", md: "minmax(0,1fr) 1px minmax(0,1fr)" },
                gap: 2,
                mt: 2,
                mb: 3,
              }}
            >
              <Box>
                <Typography sx={{ fontWeight: 500, color: DQ.danger, mb: 2 }}>Workers with Lowest Score</Typography>
                <Pending loaded={lowest} reserve={{ minHeight: 300 }}>
                  {(page) => <WorkerList rows={page.workers} none={`No worker scored below ${lowText} this ${noun}.`} />}
                </Pending>
              </Box>
              <Divider orientation="vertical" sx={{ display: { xs: "none", md: "block" } }} />
              <Box>
                <Typography sx={{ fontWeight: 500, color: DQ.successText, mb: 2 }}>Workers with Highest Score</Typography>
                <Pending loaded={highest} reserve={{ minHeight: 300 }}>
                  {(page) => (
                    <WorkerList rows={page.workers} none={`No worker scored ${highText} or above this ${noun}.`} />
                  )}
                </Pending>
              </Box>
            </Box>
          )}
          <Box sx={{ mt: "auto" }}>
            <Legend settings={settings} withMid={layout === "map"} />
          </Box>
        </Panel>
      </Stack>
      <Stack
        component="aside"
        spacing={1.25}
        aria-label="Top reasons for poor quality"
        sx={{ borderLeft: { lg: `1px solid ${DQ.border}` }, pl: { lg: 2 } }}
      >
        <Heading>Top Reason for Poor Quality</Heading>
        <Typography variant="caption" sx={{ color: DQ.textMuted }}>
          Across all workers · {periodLabel(grain, span)}
        </Typography>
        <Pending loaded={rules} reserve={{ minHeight: 280 }}>{(found) => <TopReasons rules={found.rules} />}</Pending>
      </Stack>
    </Box>
  );
}

function DailyActivity() {
  const { grain, span, context } = useDashboard();
  const start = span?.start ?? "";
  const days = useLoad(() => dqsApi.days(grain, start), [grain, start], !!span);
  const counted = screenings(context);
  // A financial year is counted by week and the other grains by day, as the days route does.
  const bucket = grain === "year" ? "week" : "day";
  return (
    <Panel sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="baseline" flexWrap="wrap" useFlexGap spacing={1}>
        <Heading>{bucket === "week" ? "Weekly" : "Daily"} Activity</Heading>
        {days.state === "ok" && <Freshness loadedAt={days.value.loaded_at} coveredTo={days.value.covered_to} />}
      </Stack>
      <Typography variant="caption" sx={{ color: DQ.textMuted }}>
        Screenings each {bucket} of {span ? periodLabel(grain, span) : "the period"} by visit date. Counts only; nothing here
        is a score.
      </Typography>
      {/* About the chart's own shape, with its key above and the line under it. */}
      <Pending loaded={days} reserve={{ aspectRatio: "760 / 250" }}
        empty={`No records in ${span ? periodLabel(grain, span) : "this period"}.`}>
        {(found) => {
          const latest = latestDay(found.days);
          const shown = latest ? shownCounts(latest, counted) : null;
          const unplaced = found.days.reduce((sum, day) => sum + shownCounts(day, counted).unplaced, 0);
          return (
            <>
              <DailyBars found={found} mode="records" counted={counted} noun="screenings" />
              <Stack direction="row" spacing={4} useFlexGap flexWrap="wrap"
                sx={{ borderTop: `1px solid ${DQ.border}`, pt: 1.5, fontSize: 13 }}>
                {latest && shown && (
                  <Typography variant="body2">
                    <b>{found.bucket === "day" ? dayMonth(latest.start) : `Week of ${dayMonth(latest.start)}`}:</b>{" "}
                    {int(shown.records)} screenings, {int(shown.failed)} failing at least one check
                  </Typography>
                )}
                {unplaced > 0 && (
                  <Typography variant="body2" sx={{ color: DQ.warning }}>
                    <b>Not placed in a taluk:</b> {int(unplaced)} screening{unplaced === 1 ? "" : "s"} this{" "}
                    {PERIOD_NOUN[grain].toLowerCase()} (No village on file)
                  </Typography>
                )}
              </Stack>
            </>
          );
        }}
      </Pending>
    </Panel>
  );
}

function Kpis({ page, grain, onInsufficient }: { page: WorkersPage; grain: Grain; onInsufficient: () => void }) {
  const { context } = useDashboard();
  const now = page.summary;
  const before = page.previous;
  const noun = PERIOD_NOUN[grain];
  const share = (part: number, whole: number) => (whole ? part / whole : null);
  const shareChange = (key: "low" | "high") =>
    before && before.scored && now.scored ? now[key] / now.scored - before[key] / before.scored : null;
  const points = (x: number) => `${(x * 100).toFixed(1)} pts`;
  const kpis = [
    {
      title: "Records Assessed",
      value: int(now.records),
      unit: "records",
      change: (
        <Change noun={noun} goodUp={null} format={(x) => pct(x)}
          delta={before && before.records ? (now.records - before.records) / before.records : null} />
      ),
    },
    {
      title: "Workers Assessed",
      value: int(now.scored),
      unit: `of ${int(now.workers)}`,
      change: <Change noun={noun} goodUp={true} format={int} delta={before ? now.scored - before.scored : null} />,
    },
    {
      title: "Workers with Low Scores",
      value: int(now.low),
      unit: `(${pct(share(now.low, now.scored))})`,
      change: <Change noun={noun} goodUp={false} format={points} delta={shareChange("low")} />,
    },
    {
      title: "Workers with High Scores",
      value: int(now.high),
      unit: `(${pct(share(now.high, now.scored))})`,
      change: <Change noun={noun} goodUp={true} format={points} delta={shareChange("high")} />,
    },
  ];
  const nMin = context.settings?.n_min;
  return (
    <>
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", lg: "repeat(4, 1fr)" }, gap: 2 }}>
        {kpis.map((kpi) => (
          <Panel key={kpi.title} sx={{ display: "flex", flexDirection: "column", gap: 1, minHeight: 150 }}>
            {kpi.change}
            <Typography variant="body2" sx={{ fontWeight: 500 }}>
              {kpi.title}
            </Typography>
            <Typography sx={{ mt: "auto", fontSize: 32, lineHeight: "40px", fontWeight: 300 }}>
              {kpi.value}
              <Typography component="small" sx={{ fontSize: 16, color: DQ.textSubtle, ml: 0.75 }}>
                {kpi.unit}
              </Typography>
            </Typography>
          </Panel>
        ))}
      </Box>
      <Typography variant="caption" sx={{ color: DQ.link }}>
        {now.insufficient ? (
          <>
            {now.insufficient} worker{now.insufficient === 1 ? "" : "s"} submitted fewer than {nMin ?? "the minimum"}{" "}
            records this {noun.toLowerCase()} and could not be scored.{" "}
            <Link component="button" variant="caption" onClick={onInsufficient} sx={{ color: DQ.link, verticalAlign: "baseline" }}>
              See who →
            </Link>
          </>
        ) : (
          `Every worker with records this ${noun.toLowerCase()} had enough to be scored.`
        )}
      </Typography>
    </>
  );
}

// Two loads as one: loading until both are in, the first error if either failed, and
// otherwise `join` of their values.
function both<A, B, T>(a: Loaded<A>, b: Loaded<B>, join: (a: A, b: B) => T): Loaded<T> {
  if (a.state === "error") return a;
  if (b.state === "error") return b;
  if (a.state === "loading" || b.state === "loading") return { state: "loading" };
  return { state: "ok", value: join(a.value, b.value) };
}

// Where the map is: India, the tenant's district when it has one, and its count of taluks.
// The state is not served by DQS, so it is left out.
function Crumbs({ district, taluks }: { district: string | null; taluks: number | null }) {
  const parts = ["India", district, taluks == null ? null : `${taluks} taluk${taluks === 1 ? "" : "s"}`].filter(
    (part): part is string => !!part,
  );
  return (
    <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 0.5 }}>
      {parts.map((part, i) => (
        <Stack key={part} direction="row" spacing={0.5} alignItems="center">
          {i > 0 && <ChevronRightIcon sx={{ fontSize: 16, color: DQ.text }} />}
          <Typography variant="caption" sx={{ color: i === 0 ? DQ.textDisabled : DQ.link }}>{part}</Typography>
        </Stack>
      ))}
    </Stack>
  );
}

export function NameCell({ row }: { row: { worker_id: string; name: string | null } }) {
  return (
    <>
      {row.name || row.worker_id}
      {row.name && row.name !== row.worker_id && (
        <Box component="span" sx={{ display: "block", color: DQ.textDisabled }}>
          {row.worker_id}
        </Box>
      )}
    </>
  );
}

function WorkerList({ rows, none }: { rows: WorkerRow[]; none: string }) {
  const go = useGo();
  return (
    <Box sx={{ overflowX: "auto" }}>
      <Table size="small" sx={TABLE_SX}>
        <TableHead>
          <TableRow>
            <TableCell>Name</TableCell>
            <TableCell>Location</TableCell>
            <TableCell>Screening</TableCell>
            <TableCell>DQ Score</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.length ? (
            rows.map((row) => (
              <ClickRow key={`${row.worker_id}-${row.peer_group_key}`} onOpen={() => go("workers", workerLink(row))}>
                <TableCell sx={{ verticalAlign: "top" }}><NameCell row={row} /></TableCell>
                <TableCell sx={{ verticalAlign: "top" }}>{place(row)}</TableCell>
                <TableCell sx={{ verticalAlign: "top" }}>{int(row.n_records)}</TableCell>
                <TableCell><TrustCell trust={row.trust} previous={row.previous_trust} insufficient={row.insufficient} /></TableCell>
              </ClickRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={4} sx={{ color: DQ.textSubtle }}>{none}</TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </Box>
  );
}

// The three rules with the most failures among those that count towards a score. A card opens
// the rule in Quality Dimensions with no taluk named, and that view opens the taluk where the
// rule failed most.
function TopReasons({ rules }: { rules: RuleFailures[] }) {
  const { context, rules: infos } = useDashboard();
  const go = useGo();
  const top = rules
    .filter((rule) => rule.scored !== false && rule.n_violations > 0)
    .sort((a, b) => b.n_violations - a.n_violations || a.rule_id.localeCompare(b.rule_id))
    .slice(0, 3);
  if (!top.length) return <Typography variant="body2" sx={{ color: DQ.textSubtle }}>No rule failures in this period.</Typography>;
  const open = (rule: RuleFailures) => go("dimensions", { gate: GATE_GROUP[rule.feeds], rule: rule.rule_id });
  return (
    <>
      {top.map((rule) => (
        <ReasonCard
          key={rule.rule_id}
          ruleId={rule.rule_id}
          title={rule.title || rule.rule_id}
          group={GATE_GROUP[rule.feeds] || dimensionName(rule.dimension)}
          records={rule.n_evaluated}
          failures={rule.n_violations}
          noun={checkedNoun(infos[rule.rule_id], context.photo_record_type)}
          rate={rule.rate}
          onClick={() => open(rule)}
        />
      ))}
      <Link component="button" variant="caption" onClick={() => open(top[0])}
        sx={{ color: DQ.link, textAlign: "left", pt: 2, pb: 3, borderBottom: `1px solid ${DQ.border}` }}>
        Click to view workers who need training
      </Link>
    </>
  );
}
