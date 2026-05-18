import { Paper, Typography } from "@mui/material";
import { EncounterList } from "@/components/EncounterList";

interface Props {
  mode: "pending" | "completed";
}

const TITLES: Record<Props["mode"], string> = {
  pending: "Pending reviews",
  completed: "Previously completed reviews",
};

export function ReviewListPage({ mode }: Props) {
  return (
    <>
      <Typography variant="h5" sx={{ mb: 2 }}>
        {TITLES[mode]}
      </Typography>
      <Paper variant="outlined" sx={{ overflow: "hidden" }}>
        <EncounterList mode={mode} />
      </Paper>
    </>
  );
}
