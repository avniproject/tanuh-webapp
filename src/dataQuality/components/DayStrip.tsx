// A worker's days in the selected week as a strip of seven cells, each with the day's count,
// shaded by how busy the day was against the busiest day of the week, and the day's failures
// as a red number under it. A month or a year has too many days for cells, so it is drawn as
// a short `DailyBars` instead.

import { Box, Stack, Typography } from "@mui/material";
import type { DaysInPeriod } from "../api/types";
import { levelOf, shownCounts } from "../days";
import type { Counted } from "../days";
import { dayMonth, int } from "../format";
import { DQ } from "../tokens";
import { DailyBars } from "./DailyBars";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
// Lightest to darkest; the last is dark enough to carry white text.
const SHADES = [DQ.surface, DQ.brandSubtle, "#b7dcdd", "#8fc3c5", "#4f9a9e"];

export function DayStrip({ found, counted = {}, noun = "records" }: { found: DaysInPeriod; counted?: Counted; noun?: string }) {
  if (found.days.length !== 7)
    return <DailyBars found={found} mode="records" counted={counted} noun={noun} height={120} />;
  const cells = found.days.map((day) => ({ day, ...shownCounts(day, counted) }));
  const busiest = Math.max(0, ...cells.map((cell) => cell.records));
  return (
    <Stack spacing={1}>
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 0.75 }}>
        {cells.map((cell, i) => {
          const level = cell.day.future ? 0 : levelOf(cell.records, busiest);
          return (
            <Box key={cell.day.start} sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0.5 }}>
              <Typography sx={{ fontSize: 11, color: DQ.textSubtle }}>{WEEKDAYS[i]}</Typography>
              <Box
                title={
                  cell.day.future
                    ? `${dayMonth(cell.day.start)}: not yet`
                    : `${dayMonth(cell.day.start)}: ${int(cell.records)} ${noun}, ${int(cell.failed)} failing`
                }
                sx={{
                  width: "100%", minHeight: 56, borderRadius: 1, boxSizing: "border-box",
                  border: cell.day.future ? `1px dashed ${DQ.textDisabled}` : `1px solid ${DQ.border}`,
                  bgcolor: SHADES[level], color: level === 4 ? DQ.surface : DQ.text,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                <Typography sx={{ fontSize: 16, fontWeight: 500, color: "inherit" }}>
                  {cell.day.future ? "" : int(cell.records)}
                </Typography>
              </Box>
              <Typography sx={{ fontSize: 12, fontWeight: 500, color: DQ.danger, minHeight: 18 }}>
                {cell.failed > 0 ? int(cell.failed) : ""}
              </Typography>
              <Typography sx={{ fontSize: 11, color: DQ.textSubtle }}>{dayMonth(cell.day.start)}</Typography>
            </Box>
          );
        })}
      </Box>
      <Typography variant="caption" sx={{ color: DQ.textMuted }}>
        Darker cells hold more {noun}. Red: {noun} failing at least one check.
      </Typography>
    </Stack>
  );
}
