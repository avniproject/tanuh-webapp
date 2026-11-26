// The Workers view: every worker of the period, ten to a page, filtered by taluk and status,
// and the selected worker's profile beside the table.
//
// A row is one worker-period. A worker filed under two taluks in a period has two rows, told
// apart by their peer group, so the selected row is the URL's `worker` and `group` together.
// A link with a worker and no group opens the worker's row with no peer group, or else their
// first, and then names that row's group in the URL.
//
// The table is DQS's workers route for the filters, with each worker's last visit in the
// period. The profile reads the worker's score for the period (its four gates and its rule
// outcomes), the worker's screenings day by day from DQS's days route, and every period the
// worker has at this grain, for the DQ Score Over Time chart, with the top reasons for poor
// quality last. On a wide screen the profile is pinned beside the table and scrolls on its own.
// Its name and place come from the table row; a worker opened from another view whose row has
// not been seen yet is shown by id.
// Selecting one of the worker's top reasons lists the records that rule failed, with a link to
// each in Avni; a batch rule, which has no failing records, opens in Quality Dimensions
// instead.

import { useEffect, useState } from "react";
import { Box, Chip, Pagination, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";
import { dqsApi } from "../api/client";
import type { GateScore, RuleRow, WorkerPeriod, WorkerRow } from "../api/types";
import { DayStrip } from "../components/DayStrip";
import { FailedRecords } from "../components/FailedRecords";
import type { FailedRecordsTarget } from "../components/FailedRecords";
import { screenings } from "../days";
import { groupOf, historyOf, periodOf, rowKey, workerLink } from "../rows";
import { LineChart } from "../components/LineChart";
import {
  ClickRow,
  FilterChip,
  GateCell,
  Heading,
  Legend,
  Panel,
  Pending,
  PlainSelect,
  ReasonCard,
  SectionTitle,
  StatusPill,
  TABLE_SX,
  TrustCell,
} from "../components/ui";
import {
  GATE_GROUP,
  PERIOD_NOUN,
  STATUS_KEY,
  STATUS_LABEL,
  STATUS_OF_KEY,
  checkedNoun,
  dayMonth,
  dimensionName,
  f2,
  int,
  periodLabel,
  periodShort,
  place,
  suspicionText,
} from "../format";
import type { StatusKey } from "../format";
import { useGo } from "../navigation";
import { useDashboard, useLoad, useParam, useSetParams } from "../state";
import { DQ } from "../tokens";
import { NameCell } from "./HealthCheck";

const PAGE_SIZE = 10;

// Rows seen in any table this session, by worker and peer group, so that a worker opened from
// another view is named.
const seen = new Map<string, WorkerRow>();

export function Workers() {
  const { grain, span, context } = useDashboard();
  const taluk = useParam("taluk");
  const statusParam = useParam("status");
  const pageParam = useParam("page");
  const worker = useParam("worker");
  const group = useParam("group");
  const setParams = useSetParams();
  const start = span?.start ?? "";
  const status = (statusParam && statusParam in STATUS_OF_KEY ? statusParam : null) as StatusKey | null;
  const page = Math.max(1, Number(pageParam) || 1);

  const units = useLoad(() => dqsApi.units(grain, start), [grain, start], !!span);
  const rows = useLoad(
    () =>
      dqsApi
        .workers(grain, start, { unitId: taluk, status: status ? STATUS_OF_KEY[status] : null, page, pageSize: PAGE_SIZE })
        .then((found) => {
          found.workers.forEach((row) => seen.set(rowKey(row.worker_id, groupOf(row.peer_group_key)), row));
          return found;
        }),
    [grain, start, taluk, status, page],
    !!span,
  );

  if (!span) return <Typography sx={{ color: DQ.textSubtle }}>No scores are stored at this grain yet.</Typography>;
  const first = rows.state === "ok" && rows.value.workers.length ? rows.value.workers[0] : null;
  const selected = worker
    ? { workerId: worker, group }
    : first
      ? { workerId: first.worker_id, group: groupOf(first.peer_group_key) }
      : null;
  const chips: [StatusKey | null, string][] = [
    [null, "All"],
    ["low", STATUS_LABEL.low],
    ["high", STATUS_LABEL.high],
    ["slip", STATUS_LABEL.slip],
    ["ins", STATUS_LABEL.ins],
  ];

  return (
    <Stack spacing={2} sx={{ minWidth: 0 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" useFlexGap spacing={1.5}>
        <SectionTitle>Workers Performance</SectionTitle>
        <PlainSelect
          label="Taluk"
          value={taluk ?? ""}
          onChange={(value) => {
            setParams({ taluk: value || null, page: null, worker: null, group: null });
          }}
          options={[
            { value: "", label: "Select Taluk" },
            ...(units.state === "ok" ? units.value.units.map((u) => ({ value: u.unit_id, label: u.name || u.unit_id })) : []),
          ]}
        />
      </Stack>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", lg: "minmax(0,1fr) 360px", xl: "minmax(0,1fr) 435px" },
          gap: 3,
          alignItems: "start",
        }}
      >
        <Panel sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" role="group" aria-label="Status">
            {chips.map(([key, label]) => (
              <FilterChip
                key={label}
                label={label}
                selected={status === key}
                onClick={() => {
                  setParams({ status: key, page: null, worker: null, group: null });
                }}
              />
            ))}
          </Stack>
          <Pending loaded={rows} reserve={{ minHeight: 560 }} empty={`No worker scores are stored for ${periodLabel(grain, span)}.`}>
            {(found) => (
              <>
                <Box sx={{ overflowX: "auto" }}>
                  <Table size="small" sx={TABLE_SX}>
                    <TableHead>
                      <TableRow>
                        <TableCell>Name</TableCell>
                        <TableCell>Location</TableCell>
                        <TableCell>DQ Score</TableCell>
                        <TableCell>Sufficiency</TableCell>
                        <TableCell title="Provenance confidence">Genuineness</TableCell>
                        <TableCell>Fidelity</TableCell>
                        <TableCell>Status</TableCell>
                        <TableCell>Last Record</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {found.workers.length ? (
                        found.workers.map((row) => (
                          <ClickRow
                            key={`${row.worker_id}-${row.peer_group_key}`}
                            selected={
                              row.worker_id === selected?.workerId && groupOf(row.peer_group_key) === selected.group
                            }
                            onOpen={() => setParams(workerLink(row))}
                          >
                            <TableCell><NameCell row={row} /></TableCell>
                            <TableCell>{place(row)}</TableCell>
                            <TableCell><TrustCell trust={row.trust} previous={row.previous_trust} insufficient={row.insufficient} /></TableCell>
                            <TableCell><GateCell gate={row.sufficiency} insufficient={row.insufficient} /></TableCell>
                            <TableCell><GateCell gate={row.provenance_confidence} insufficient={row.insufficient} /></TableCell>
                            <TableCell><GateCell gate={row.quality} insufficient={row.insufficient} /></TableCell>
                            <TableCell><StatusPill status={row.status ? STATUS_KEY[row.status] : null} /></TableCell>
                            <TableCell>{row.last_visit_date ? dayMonth(row.last_visit_date) : "—"}</TableCell>
                          </ClickRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={8} sx={{ color: DQ.textSubtle }}>No workers match these filters.</TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </Box>
                <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" useFlexGap
                  spacing={2} sx={{ borderTop: `1px solid ${DQ.border}`, pt: 3 }}>
                  <Legend settings={context.settings} withMid={false} />
                  {found.total > PAGE_SIZE && (
                    <Pagination
                      size="small"
                      page={found.page}
                      count={Math.ceil(found.total / PAGE_SIZE)}
                      onChange={(_, next) => {
                        setParams({ page: String(next), worker: null, group: null });
                      }}
                    />
                  )}
                </Stack>
              </>
            )}
          </Pending>
        </Panel>
        {/* Pinned beside the table and no taller than the window, so that the whole profile
            can be scrolled to while the table stays in view. */}
        <Panel
          sx={{
            display: "flex",
            flexDirection: "column",
            gap: 2,
            position: { lg: "sticky" },
            top: { lg: 16 },
            maxHeight: { lg: "calc(100vh - 32px)" },
            overflowY: { lg: "auto" },
          }}
        >
          {selected ? (
            <Profile workerId={selected.workerId} group={selected.group} />
          ) : (
            <Typography variant="body2" sx={{ color: DQ.textSubtle }}>Select a worker to see their scores.</Typography>
          )}
        </Panel>
      </Box>
    </Stack>
  );
}

const TILE_COLOUR = { low: DQ.danger, high: DQ.brand, mid: DQ.text };

function Tile({ label, gate, insufficient, extra }: {
  label: string;
  gate: GateScore | null;
  insufficient: boolean;
  extra?: string | null;
}) {
  const colour = !insufficient && gate ? TILE_COLOUR[gate.band] : DQ.text;
  // The interval is stored on 0-100; it is shown on the same 1-5 scale as the score.
  const range = gate && !insufficient ? `Range ${f2(1 + (4 * gate.low) / 100)} – ${f2(1 + (4 * gate.high) / 100)}` : null;
  return (
    <Box sx={{ bgcolor: DQ.surfaceSubtle, border: `1px solid ${DQ.border}`, borderRadius: 1, p: 2, display: "flex", flexDirection: "column", gap: 0.5 }}>
      <Typography sx={{ color: colour }}>{label}</Typography>
      <Typography sx={{ fontSize: 20, color: DQ.textMuted }}>
        {insufficient ? "—" : gate ? f2(gate.scale) : <Box component="span" sx={{ fontSize: 14, color: DQ.textDisabled }}>Not measured</Box>}
      </Typography>
      <Typography sx={{ fontSize: 10, color: DQ.textSubtle, minHeight: 14 }}>{extra ?? range ?? ""}</Typography>
    </Box>
  );
}

function Profile({ workerId, group }: { workerId: string; group: string | null }) {
  const { grain, span, context, rules } = useDashboard();
  const go = useGo();
  const start = span!.start;
  const period = useLoad(() => dqsApi.workerPeriod(workerId, grain, start), [workerId, grain, start]);
  const history = useLoad(() => dqsApi.workerHistory(workerId, grain), [workerId, grain]);
  const days = useLoad(
    () => dqsApi.days(grain, start, { workerId, peerGroupKey: group }),
    [workerId, group, grain, start],
  );
  const setParams = useSetParams();
  const [failures, setFailures] = useState<FailedRecordsTarget | null>(null);
  const row = seen.get(rowKey(workerId, group));
  const noun = PERIOD_NOUN[grain].toLowerCase();

  const scored: WorkerPeriod | null = period.state === "ok" ? periodOf(period.value.periods, group) : null;
  const insufficient = scored?.insufficient ?? false;
  // A link with a worker and no group opens the worker's first row; naming that row's group
  // in the URL is what lets the table highlight it and the panel name its taluk.
  useEffect(() => {
    if (group == null && scored?.peer_group_key != null) setParams({ group: String(scored.peer_group_key) });
  }, [group, scored, setParams]);
  const points = history.state === "ok" ? historyOf(history.value.periods, group) : [];
  const last = points.length ? points[points.length - 1].period_start : null;
  // The gate comes from the worker's own rule row, which every rule they were scored on has,
  // even one the dashboard context no longer lists.
  const openRule = (ruleId: string) => {
    const feeds = scored?.rules.find((one) => one.rule_id === ruleId)?.feeds ?? rules[ruleId]?.feeds ?? "quality";
    go("dimensions", { gate: GATE_GROUP[feeds], rule: ruleId, unit: row?.taluk_id });
  };
  const top: RuleRow[] = scored
    ? scored.rules
        .filter((rule) => rule.n_violations > 0 && rules[rule.rule_id]?.scored !== false)
        .sort((a, b) => b.n_violations - a.n_violations)
        .slice(0, 3)
    : [];
  const tag = (name: string, value: string) => (
    <Chip size="small" sx={{ bgcolor: DQ.surfaceMuted }}
      label={<><Box component="span" sx={{ color: DQ.textDisabled, mr: 1 }}>{name}</Box>{value}</>} />
  );

  return (
    <>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" useFlexGap spacing={1}>
        <Heading>{row?.name || workerId}</Heading>
        {row?.taluk_name && (
          <Chip size="small" sx={{ bgcolor: DQ.brandSubtle, "& .MuiChip-label": { color: DQ.brand } }}
            label={<><Box component="span" sx={{ color: DQ.textDisabled, mr: 1 }}>Taluk</Box>{row.taluk_name}</>} />
        )}
      </Stack>
      <Typography variant="caption" sx={{ color: DQ.textSubtle }}>
        {row?.name && <Box component="span" sx={{ mr: 1 }}>{workerId}</Box>}
        {row && <Box component="b" sx={{ fontWeight: 400, color: DQ.text }}>{place(row)}</Box>}
      </Typography>
      <Stack direction="row" spacing={2} useFlexGap flexWrap="wrap" alignItems="center" sx={{ pb: 2, borderBottom: `1px solid ${DQ.border}` }}>
        {tag("Volume", scored ? int(scored.n_records) : "0")}
        {tag("Last Activity", last ? periodShort(grain, last) : "—")}
        <StatusPill status={insufficient ? "ins" : scored?.trend ? STATUS_KEY[scored.trend] : null} />
      </Stack>
      <Pending loaded={period} reserve={{ minHeight: 200 }} empty={`No records in ${periodLabel(grain, span!)}.`}>
        {() =>
          scored ? (
            <>
              {insufficient && (
                <Typography variant="body2" sx={{ color: DQ.textSubtle }}>
                  {scored.n_records} record{scored.n_records === 1 ? "" : "s"} this {noun}
                  {context.settings ? `; ${context.settings.n_min} are needed to score` : ""}. No score is stored.
                </Typography>
              )}
              <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.25 }}>
                <Tile label="DQ Score" gate={scored.trust} insufficient={insufficient} />
                <Tile label="Sufficiency" gate={scored.sufficiency} insufficient={insufficient} />
                <Tile label="Genuineness" gate={scored.provenance_confidence} insufficient={insufficient}
                  extra={insufficient ? null : suspicionText(scored.fabrication_suspicion)} />
                <Tile label="Fidelity" gate={scored.quality} insufficient={insufficient} />
              </Box>
            </>
          ) : (
            <Typography variant="body2" sx={{ color: DQ.textSubtle }}>No records in {periodLabel(grain, span!)}.</Typography>
          )
        }
      </Pending>
      <Box sx={{ bgcolor: DQ.surfaceSubtle, border: `1px solid ${DQ.border}`, borderRadius: 1, p: 2 }}>
        <Typography variant="body2" sx={{ fontWeight: 500, mb: 1 }}>
          Screenings Each {grain === "year" ? "Week" : "Day"} This {PERIOD_NOUN[grain]}
        </Typography>
        <Pending loaded={days} reserve={{ minHeight: 130 }} empty={`No records in ${periodLabel(grain, span!)}.`}>
          {(found) => <DayStrip found={found} counted={screenings(context)} noun="screenings" />}
        </Pending>
      </Box>
      <Box sx={{ bgcolor: DQ.surfaceSubtle, border: `1px solid ${DQ.border}`, borderRadius: 1, p: 2 }}>
        <Typography variant="body2" sx={{ fontWeight: 500, mb: 0.5 }}>DQ Score Over Time</Typography>
        <Pending loaded={history} reserve={{ aspectRatio: "380 / 190" }} empty="No scored periods.">
          {() => (
            <LineChart
              settings={context.settings}
              points={points.map((point) => ({
                label: dayMonth(point.period_start),
                value: point.insufficient || !point.trust ? null : point.trust.scale,
                insufficient: point.insufficient,
                current: point.period_start === start,
              }))}
            />
          )}
        </Pending>
      </Box>
      {/* Last, so that the day strip and the chart sit under the scores without scrolling. */}
      <Pending loaded={period} reserve={{ minHeight: 220 }}>
        {() =>
          scored && (
            <Stack spacing={1.25} sx={{ bgcolor: DQ.surfaceSubtle, borderRadius: 1, p: 2 }}>
              <Typography variant="body2" sx={{ fontWeight: 500 }}>Top Reason for Poor Quality</Typography>
              {top.length ? (
                top.map((rule) => (
                  <ReasonCard
                    key={rule.rule_id}
                    ruleId={rule.rule_id}
                    title={rules[rule.rule_id]?.title || rule.rule_id}
                    group={GATE_GROUP[rule.feeds] || dimensionName(rule.dimension)}
                    records={rule.n_evaluated}
                    failures={rule.n_violations}
                    noun={checkedNoun(rules[rule.rule_id], context.photo_record_type)}
                    rate={rule.rate}
                    onClick={() =>
                      // A batch rule judges the whole period and has no failing records to list.
                      rules[rule.rule_id]?.kind === "batch"
                        ? openRule(rule.rule_id)
                        : setFailures({ ruleId: rule.rule_id, workerId, workerName: row?.name || workerId, group })
                    }
                  />
                ))
              ) : (
                <Typography variant="body2" sx={{ color: DQ.textSubtle }}>No rule failures this {noun}.</Typography>
              )}
            </Stack>
          )
        }
      </Pending>
      <FailedRecords target={failures} onClose={() => setFailures(null)} onRule={openRule} />
    </>
  );
}
