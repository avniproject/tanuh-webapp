// The Quality Dimensions view: one taluk's Sufficiency, Genuineness and Fidelity for the
// period with their change since the period before, the rejection reasons of one gate in that
// taluk ordered by failures, and the workers who failed the selected rule.
//
// The cards read DQS's units route. The reasons read the rules route kept to the taluk and
// the gate's feeds. The workers read the rule's workers route kept to the taluk, all of them
// at once, so that the note under the table can say whether the failures are concentrated in
// a few workers; the table pages through them ten at a time.

import {
  Box,
  ButtonBase,
  Chip,
  Pagination,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { MAX_PAGE_SIZE, dqsApi } from "../api/client";
import type { GateScore, RuleFailures, UnitRow } from "../api/types";
import {
  Change,
  ClickRow,
  Dot,
  FilterChip,
  Heading,
  Legend,
  Panel,
  Pending,
  PlainSelect,
  SectionTitle,
  TABLE_SX,
} from "../components/ui";
import type { DotKind } from "../components/ui";
import {
  GROUP_FEEDS,
  PERIOD_NOUN,
  QUESTION,
  dimensionName,
  f2,
  int,
  pct,
  periodLabel,
  place,
  shortId,
  suspicionText,
} from "../format";
import type { GateGroup } from "../format";
import { useGo } from "../navigation";
import { useDashboard, useLoad, useParam, useSetParams } from "../state";
import { DQ } from "../tokens";
import { NameCell } from "./HealthCheck";

// Display choices for the note under the failures table. They are set by these screens, not
// by the rulepack, and change no score.
// A worker is counted as failing heavily when the rule failed on at least this share of their
// records (and applied to at least the rule minimum of them).
export const HEAVY_FAILURE_RATE = 0.15;
// "The top workers" of a rule are this share of the workers with any failure of it.
export const TOP_WORKERS_SHARE = 0.2;
// The failures are called concentrated when the top workers account for this share of them.
export const CONCENTRATED_SHARE = 0.5;

const PAGE_SIZE = 10;
const GROUPS: GateGroup[] = ["Sufficiency", "Genuineness", "Fidelity"];

export function Dimensions() {
  const { grain, span } = useDashboard();
  const unitParam = useParam("unit");
  const gateParam = useParam("gate");
  const ruleParam = useParam("rule");
  const setParams = useSetParams();
  const start = span?.start ?? "";
  const gate: GateGroup = GROUPS.includes(gateParam as GateGroup) ? (gateParam as GateGroup) : "Sufficiency";
  const units = useLoad(() => dqsApi.units(grain, start), [grain, start]);

  const title = (
    <Stack direction="row" spacing={1.5} alignItems="center">
      <SectionTitle>Quality Dimensions</SectionTitle>
      <Chip size="small" label="NP-NCD Data" sx={{ bgcolor: DQ.brandSubtle, "& .MuiChip-label": { color: DQ.brand } }} />
    </Stack>
  );
  if (!span) return <Typography sx={{ color: DQ.textSubtle }}>No scores are stored at this grain yet.</Typography>;

  return (
    <Pending loaded={units} empty={`No taluk scores are stored for ${periodLabel(grain, span)}.`}>
      {(found) => {
        if (!found.units.length)
          return (
            <Stack spacing={2}>
              {title}
              <Panel>
                <Typography variant="body2" sx={{ color: DQ.textSubtle }}>No taluk scores are stored for this period.</Typography>
              </Panel>
            </Stack>
          );
        const unit = found.units.find((one) => one.unit_id === unitParam) ?? found.units[0];
        return (
          <Stack spacing={2} sx={{ minWidth: 0 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" useFlexGap spacing={1.5}>
              {title}
              <PlainSelect
                label="Taluk"
                value={unit.unit_id}
                onChange={(value) => {
                  setParams({ unit: value, rule: null, rpage: null });
                }}
                options={found.units.map((one) => ({ value: one.unit_id, label: one.name || one.unit_id }))}
              />
            </Stack>
            <GateCards unit={unit} />
            <Reasons
              unit={unit}
              gate={gate}
              rule={ruleParam}
              onGate={(next) => {
                setParams({ gate: next, rule: null, rpage: null });
              }}
              onRule={(next) => {
                setParams({ rule: next, rpage: null });
              }}
            />
          </Stack>
        );
      }}
    </Pending>
  );
}

function GateCards({ unit }: { unit: UnitRow }) {
  const { grain } = useDashboard();
  const before = unit.previous && !unit.previous.insufficient ? unit.previous : null;
  const keys: [GateGroup, "sufficiency" | "provenance_confidence" | "quality"][] = [
    ["Sufficiency", "sufficiency"],
    ["Genuineness", "provenance_confidence"],
    ["Fidelity", "quality"],
  ];
  const cards = keys.map(([group, key]) => ({
    group,
    now: unit.insufficient ? null : unit[key],
    then: before ? before[key] : null,
  }));
  const measured = cards.filter((card) => card.now);
  // The weakest is the lowest score among those measured, marked only when it is lower than
  // another as shown, to two decimals; scores that read the same are not told apart.
  const shown = (card: (typeof cards)[number]) => f2((card.now as GateScore).scale);
  const lowest = measured.length > 1 ? measured.reduce((a, b) => ((b.now as GateScore).score < (a.now as GateScore).score ? b : a)) : null;
  const weakest = lowest && measured.some((card) => shown(card) !== shown(lowest)) ? lowest : null;
  const missing = (text: string) => <Box component="span" sx={{ fontSize: 16, color: DQ.textDisabled }}>{text}</Box>;
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(3, 1fr)" }, gap: { xs: 2, lg: 3 } }}>
      {cards.map((card) => (
        <Panel key={card.group} sx={{ display: "flex", flexDirection: "column", gap: 1, position: "relative", minHeight: 150 }}>
          {weakest === card && (
            <Chip size="small" label="Weakest dimension"
              sx={{ position: "absolute", top: 16, right: 10, bgcolor: DQ.warningSubtle, "& .MuiChip-label": { color: DQ.warning } }} />
          )}
          <Change noun={PERIOD_NOUN[grain]} goodUp={true} format={(x) => x.toFixed(2)}
            delta={card.now && card.then ? card.now.scale - card.then.scale : null} />
          <Typography variant="body2" sx={{ fontWeight: 500 }}>{card.group}</Typography>
          <Typography variant="caption" sx={{ color: DQ.textMuted }}>{QUESTION[card.group]}</Typography>
          <Typography sx={{ mt: "auto", fontSize: 32, lineHeight: "40px", fontWeight: 300 }}>
            {unit.insufficient ? missing("Insufficient data") : card.now ? f2(card.now.scale) : missing("Not measured")}
            {card.group === "Genuineness" && !unit.insufficient && unit.fabrication_suspicion && (
              <Typography component="small" sx={{ fontSize: 12, color: DQ.textSubtle, ml: 1 }}>
                {suspicionText(unit.fabrication_suspicion)}
              </Typography>
            )}
          </Typography>
        </Panel>
      ))}
    </Box>
  );
}

function Reasons({
  unit,
  gate,
  rule,
  onGate,
  onRule,
}: {
  unit: UnitRow;
  gate: GateGroup;
  rule: string | null;
  onGate: (gate: GateGroup) => void;
  onRule: (rule: string) => void;
}) {
  const { grain, span, rules: infos } = useDashboard();
  const start = span!.start;
  const found = useLoad(
    () => dqsApi.rules(grain, start, { unitId: unit.unit_id, feeds: GROUP_FEEDS[gate] }),
    [grain, start, unit.unit_id, gate],
  );
  const loaded = found.state === "ok" ? found.value.rules : null;
  // A rule is listed with its failures when it checked at least one record in the taluk and
  // counts towards a score. A rule measured on no record, such as an image rule for
  // screenings without images, is listed below with the others, so that its 0 is not read
  // as "passed".
  // A rule scored on a measurement may record no failures; it is then counted by the workers
  // who lost score on it.
  const byWorkers = (one: RuleFailures) => one.scores_on === "statistic" && one.n_violations === 0;
  const countOf = (one: RuleFailures) => (byWorkers(one) ? one.n_workers_flagged : one.n_violations);
  const counted = (one: RuleFailures) => one.measured && one.scored !== false && one.n_evaluated > 0;
  const failing = (loaded ?? [])
    .filter(counted)
    .sort((a, b) => countOf(b) - countOf(a) || a.rule_id.localeCompare(b.rule_id));
  const why = (one: RuleFailures) =>
    one.scored === false ? "Not scored" : !one.measured ? "Not measured" : "No records checked";
  const ORDER = ["No records checked", "Not measured", "Not scored"];
  const other = (loaded ?? [])
    .filter((one) => !counted(one))
    .sort((a, b) => ORDER.indexOf(why(a)) - ORDER.indexOf(why(b)) || a.rule_id.localeCompare(b.rule_id));
  const chosen = failing.find((one) => one.rule_id === rule) ?? failing[0] ?? null;
  // Two rules can share a title, such as the same check on two record types; those are shown
  // with their ids so that they can be told apart.
  const titleOf = (one: RuleFailures) => one.title || infos[one.rule_id]?.title || one.rule_id;
  const counts = new Map<string, number>();
  (loaded ?? []).forEach((one) => counts.set(titleOf(one), (counts.get(titleOf(one)) ?? 0) + 1));
  const label = (one: RuleFailures) =>
    (counts.get(titleOf(one)) ?? 0) > 1 ? (
      <span>
        {titleOf(one)}{" "}
        <Box component="span" sx={{ fontSize: 12, color: DQ.textDisabled, fontWeight: 400 }}>{shortId(one.rule_id)}</Box>
      </span>
    ) : (
      <span>{titleOf(one)}</span>
    );
  const row = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 1.5, minHeight: 56, px: 2, py: 1, width: "100%", textAlign: "left" };

  return (
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "minmax(0,435px) minmax(0,1fr)" }, gap: 3, alignItems: "stretch" }}>
      <Panel sx={{ p: 0, display: "flex", flexDirection: "column" }}>
        <Box sx={{ px: 2, pt: 2 }}>
          <Box sx={{ pb: 2, borderBottom: `1px solid ${DQ.border}` }}><Heading>Rejection Reasons</Heading></Box>
        </Box>
        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ p: 2 }} role="group" aria-label="Dimension">
          {GROUPS.map((group) => (
            <FilterChip key={group} label={group} selected={gate === group} onClick={() => onGate(group)} />
          ))}
        </Stack>
        <Box sx={{ pb: 1 }}>
          <Pending loaded={found}>
            {({ rules }) =>
              !rules.length ? (
                <Typography variant="body2" sx={{ color: DQ.textSubtle, px: 2, pb: 2 }}>No rules in this dimension.</Typography>
              ) : (
                <>
                  {failing.map((one) => (
                    <ButtonBase
                      key={one.rule_id}
                      aria-pressed={one === chosen}
                      title={`${shortId(one.rule_id)} · ${dimensionName(one.dimension)}`}
                      onClick={() => onRule(one.rule_id)}
                      sx={{ ...row, fontSize: 16, fontWeight: 500, bgcolor: one === chosen ? DQ.brandSubtle : "transparent",
                        "&:hover": { bgcolor: one === chosen ? DQ.brandSubtle : DQ.surfaceSubtle } }}
                    >
                      {label(one)}
                      <Box component="span" sx={{ color: DQ.brand, fontWeight: 400, whiteSpace: "nowrap" }}>
                        {byWorkers(one)
                          ? `${int(one.n_workers_flagged)} worker${one.n_workers_flagged === 1 ? "" : "s"}`
                          : int(one.n_violations)}
                      </Box>
                    </ButtonBase>
                  ))}
                  {other.map((one) => (
                    <Box key={one.rule_id} sx={{ ...row, color: DQ.textSubtle }}
                      title={`${shortId(one.rule_id)} · ${dimensionName(one.dimension)}`}>
                      {label(one)}
                      <Typography variant="caption" sx={{ color: DQ.textDisabled, whiteSpace: "nowrap" }}>
                        {why(one)}
                      </Typography>
                    </Box>
                  ))}
                </>
              )
            }
          </Pending>
        </Box>
      </Panel>
      <Panel sx={{ display: "flex", flexDirection: "column", gap: 1, minHeight: { lg: 600 } }}>
        <Heading>Areas with the most failures</Heading>
        {chosen ? (
          <RuleWorkers rule={chosen} unit={unit} />
        ) : loaded ? (
          <Typography variant="body2" sx={{ color: DQ.textSubtle }}>
            No rule in this dimension was measured for this taluk in this period.
          </Typography>
        ) : null}
      </Panel>
    </Box>
  );
}

function RuleWorkers({ rule, unit }: { rule: RuleFailures; unit: UnitRow }) {
  const { grain, span, context, rules: infos } = useDashboard();
  const go = useGo();
  const pageParam = useParam("rpage");
  const setParams = useSetParams();
  const start = span!.start;
  const found = useLoad(
    () => dqsApi.ruleWorkers(grain, start, rule.rule_id, { unitId: unit.unit_id, pageSize: MAX_PAGE_SIZE }),
    [grain, start, rule.rule_id, unit.unit_id],
  );
  const title = rule.title || infos[rule.rule_id]?.title || rule.rule_id;
  const taluk = unit.name || unit.unit_id;
  // A rule scored on a measurement shows each worker's measurement beside their failures.
  const measured = rule.scores_on === "statistic";
  return (
    <>
      <Typography variant="body2" sx={{ color: DQ.danger }}>
        {title}{" "}
        <Box component="span" sx={{ color: DQ.textSubtle, fontSize: 12 }}>· {shortId(rule.rule_id)} · {taluk}</Box>
      </Typography>
      <Pending loaded={found}>
        {(page) => {
          const affected = page.workers;
          const total = affected.reduce((sum, one) => sum + one.n_violations, 0);
          const ruleMin = context.settings?.rule_n_min;
          const heavy = affected.filter(
            (one) => (ruleMin == null || one.n_evaluated >= ruleMin) && one.rate != null && one.rate >= HEAVY_FAILURE_RATE,
          ).length;
          const topN = Math.max(1, Math.round(affected.length * TOP_WORKERS_SHARE));
          const topShare = total ? affected.slice(0, topN).reduce((sum, one) => sum + one.n_violations, 0) / total : 0;
          const pages = Math.max(1, Math.ceil(affected.length / PAGE_SIZE));
          const current = Math.min(Math.max(1, Number(pageParam) || 1), pages);
          const shown = affected.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
          return (
            <>
              <Box sx={{ overflowX: "auto" }}>
                <Table size="small" sx={TABLE_SX}>
                  <TableHead>
                    <TableRow>
                      <TableCell>Worker</TableCell>
                      <TableCell>Location</TableCell>
                      <TableCell align="right">Failures</TableCell>
                      <TableCell align="right">Of Their Records</TableCell>
                      {measured && <TableCell align="right">Measurement</TableCell>}
                      <TableCell align="right">DQ Score</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {shown.length ? (
                      shown.map((one) => {
                        const trust = one.insufficient ? null : one.trust;
                        const band: DotKind = trust ? (trust.band === "high" ? "success" : trust.band) : "ins";
                        return (
                          <ClickRow key={`${one.worker_id}-${one.peer_group_key}`} onOpen={() => go("workers", { worker: one.worker_id })}>
                            <TableCell><NameCell row={one} /></TableCell>
                            <TableCell>{place(one)}</TableCell>
                            <TableCell align="right">{int(one.n_violations)}</TableCell>
                            <TableCell align="right">{pct(one.rate)}</TableCell>
                            {measured && (
                              <TableCell align="right">{one.statistic == null ? "—" : f2(one.statistic)}</TableCell>
                            )}
                            <TableCell align="right">
                              <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 1 }}>
                                <Dot kind={band} size={10} />
                                {trust ? f2(trust.scale) : "—"}
                              </Box>
                            </TableCell>
                          </ClickRow>
                        );
                      })
                    ) : (
                      <TableRow>
                        <TableCell colSpan={measured ? 6 : 5} sx={{ color: DQ.textSubtle }}>
                          No worker in {taluk} failed this rule or lost score on it in this period.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </Box>
              {total > 0 && (
                <Typography variant="caption" sx={{ color: DQ.textSubtle }}>
                  {heavy} worker{heavy === 1 ? "" : "s"} failed it on {pct(HEAVY_FAILURE_RATE, 0)} or more of their
                  records. The top {topN} worker{topN > 1 ? "s account" : " accounts"} for {pct(topShare, 0)} of the
                  failures: {topShare >= CONCENTRATED_SHARE ? "concentrated in a few workers." : "spread across many workers."}
                </Typography>
              )}
              <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" useFlexGap
                spacing={2} sx={{ borderTop: `1px solid ${DQ.border}`, pt: 3, mt: "auto" }}>
                <Legend settings={context.settings} withMid={true} />
                {pages > 1 && (
                  <Pagination size="small" page={current} count={pages} onChange={(_, next) => setParams({ rpage: String(next) })} />
                )}
              </Stack>
            </>
          );
        }}
      </Pending>
    </>
  );
}
