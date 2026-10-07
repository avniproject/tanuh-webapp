import { Paper } from "@mui/material";
import { EncounterList } from "@/components/EncounterList";

interface Props {
  mode: "pending" | "completed";
}

export function ReviewListPage({ mode }: Props) {
  // Tabs above already serve as the page heading — no separate title needed.
  return (
    <Paper variant="outlined" sx={{ overflow: "hidden" }}>
      {/* Keyed by tab: each tab keeps its own session state (tanuh-webapp#4), so a switch must not reuse the other's. */}
      <EncounterList key={mode} mode={mode} />
    </Paper>
  );
}
