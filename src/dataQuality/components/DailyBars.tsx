// The daily counts bar chart: one bar per day of the selected period, or per week of a
// financial year, split into the records that passed and those that failed, drawn as SVG.
// A day still to come is drawn as a dashed outline, so that it does not read as a day with
// no records.
//
// In "records" mode the split is records that failed any scored rule against the rest; in
// "rule" mode it is the records one rule failed against those it passed. `counted` keeps the
// count to one record type or leaves one out, which is how the Health Check and the worker
// profile count screenings. The same counts are listed in a table that only screen readers see.

import { Box, Stack, Typography } from "@mui/material";
import type { DaysInPeriod } from "../api/types";
import { shownCounts } from "../days";
import type { Counted } from "../days";
import { dayMonth, int } from "../format";
import { DQ } from "../tokens";

// The passed share of a bar. Not one of the design's tokens: the brand colour itself is too
// close in lightness to the danger red for the two to be told apart without colour.
const PASSED = "#8fc3c5";

const HIDDEN = {
  position: "absolute",
  width: 1,
  height: 1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
} as const;

export function DailyBars({
  found,
  mode,
  counted = {},
  noun = "records",
  height = 180,
}: {
  found: DaysInPeriod;
  mode: "records" | "rule";
  counted?: Counted;
  noun?: string;
  height?: number;
}) {
  const bars = found.days.map((day) => ({ day, ...shownCounts(day, counted) }));
  const busiest = Math.max(1, ...bars.map((bar) => bar.records));
  const top = niceTop(busiest);
  const w = 760, l = 34, r = 4, t = 8, b = 22;
  const h = height;
  const pw = w - l - r, ph = h - t - b, n = bars.length;
  const slot = pw / Math.max(1, n);
  const gap = Math.min(4, slot * 0.2);
  const Y = (v: number) => t + ph - (v / top) * ph;
  const every = Math.max(1, Math.ceil(n / 12));
  const label = (start: string) => (found.bucket === "day" ? String(Number(start.slice(8))) : dayMonth(start));
  const what = mode === "rule" ? ["Passing this rule", "Failing this rule"] : ["Passed every check", "Failed at least one check"];
  const unit = found.bucket === "day" ? "day" : "week";
  const total = bars.reduce((sum, bar) => sum + bar.records, 0);
  const failed = bars.reduce((sum, bar) => sum + bar.failed, 0);

  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={2.5} useFlexGap flexWrap="wrap" sx={{ fontSize: 12, color: DQ.textMuted }}>
        <Key colour={mode === "rule" ? DQ.surfaceDisabled : PASSED} text={what[0]} />
        <Key colour={DQ.danger} text={what[1]} />
        <Key dashed text="Not yet" />
      </Stack>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label={`${int(total)} ${noun} by ${unit}, ${int(failed)} of them failing`}
        style={{ width: "100%", height: "auto", display: "block" }}
      >
        {[0, 0.5, 1].map((share) => (
          <g key={share}>
            <line stroke={DQ.border} x1={l} x2={l + pw} y1={Y(top * share)} y2={Y(top * share)} />
            <text fill={DQ.textSubtle} fontSize={10} x={l - 6} y={Y(top * share) + 3.5} textAnchor="end">
              {int(top * share)}
            </text>
          </g>
        ))}
        {bars.map((bar, i) => {
          const x = l + i * slot + gap / 2;
          const bw = slot - gap;
          const tip = bar.day.future
            ? `${dayMonth(bar.day.start)}: not yet`
            : `${dayMonth(bar.day.start)}${bar.day.end !== bar.day.start ? ` – ${dayMonth(bar.day.end)}` : ""}: ` +
              `${int(bar.records)} ${noun}, ${int(bar.failed)} failing`;
          return (
            <g key={bar.day.start}>
              <title>{tip}</title>
              {bar.day.future ? (
                <rect x={x} y={t + ph - 16} width={bw} height={16} fill="none" stroke={DQ.textDisabled} strokeDasharray="3 2" />
              ) : (
                <>
                  <rect x={x} y={Y(bar.records)} width={bw} height={Y(bar.failed) - Y(bar.records)}
                    fill={mode === "rule" ? DQ.surfaceDisabled : PASSED} />
                  <rect x={x} y={Y(bar.failed)} width={bw} height={t + ph - Y(bar.failed)} fill={DQ.danger} />
                </>
              )}
              {i % every === 0 && (
                <text fill={DQ.textSubtle} fontSize={10} x={x + bw / 2} y={h - 6} textAnchor="middle">
                  {label(bar.day.start)}
                </text>
              )}
            </g>
          );
        })}
        <line stroke={DQ.borderStrong} x1={l} x2={l + pw} y1={t + ph} y2={t + ph} />
      </svg>
      <Box component="table" sx={HIDDEN}>
        <caption>{noun[0].toUpperCase() + noun.slice(1)} by {unit}</caption>
        <thead>
          <tr>
            <th scope="col">{found.bucket === "day" ? "Day" : "Week starting"}</th>
            <th scope="col">{noun[0].toUpperCase() + noun.slice(1)}</th>
            <th scope="col">Failing</th>
          </tr>
        </thead>
        <tbody>
          {bars.map((bar) => (
            <tr key={bar.day.start}>
              <th scope="row">{dayMonth(bar.day.start)}</th>
              <td>{bar.day.future ? "Not yet" : bar.records}</td>
              <td>{bar.day.future ? "" : bar.failed}</td>
            </tr>
          ))}
        </tbody>
      </Box>
    </Stack>
  );
}

function Key({ colour, dashed, text }: { colour?: string; dashed?: boolean; text: string }) {
  return (
    <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.75 }}>
      <Box component="span" sx={{
        width: 12, height: 12, borderRadius: "2px", bgcolor: colour,
        border: dashed ? `1px dashed ${DQ.textDisabled}` : "none",
      }} />
      <Typography component="span" sx={{ fontSize: 12, color: DQ.textMuted }}>{text}</Typography>
    </Box>
  );
}

// The axis top: the busiest bar rounded up to 1, 2 or 5 times a power of ten, so that the
// half-way line falls on a round number.
function niceTop(busiest: number): number {
  const power = 10 ** Math.floor(Math.log10(busiest));
  const step = [1, 2, 5, 10].find((one) => one * power >= busiest) ?? 10;
  return step * power;
}
