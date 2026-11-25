// The line saying how current the daily counts are: when DQS last loaded its analytics
// database and the latest arrival time that load read, in the viewer's own clock. A record
// that reached DQS after that time is not counted yet. DQS loads hourly; it does not know the
// schedule, so the line says so rather than naming the next load.

import { Typography } from "@mui/material";
import { DQ } from "../tokens";

const time = (iso: string) => {
  const at = new Date(iso);
  const sameDay = at.toDateString() === new Date().toDateString();
  return at.toLocaleString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    ...(sameDay ? {} : { day: "numeric", month: "short" }),
  });
};

export function Freshness({ loadedAt, coveredTo }: { loadedAt: string | null; coveredTo: string | null }) {
  return (
    <Typography variant="caption" sx={{ color: DQ.textMuted }}>
      {loadedAt
        ? `Loaded at ${time(loadedAt)}${coveredTo ? ` · records received up to ${time(coveredTo)}` : ""} · loads hourly`
        : "Not loaded yet"}
    </Typography>
  );
}
