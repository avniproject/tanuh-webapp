import { Alert, Box, Button, CircularProgress, Paper, Stack, Typography } from "@mui/material";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import CheckIcon from "@mui/icons-material/Check";
import type { GroupCounts } from "@/api/queueChoice";
import { QUEUE_GROUPS, type QueueGroup } from "@/constants/tanuhConcepts";
import { QueueGroupBadge } from "./StatusBadge";

interface Props {
  // The viewer's finished reviews today, by group.
  reviewed: GroupCounts;
  // Cases nobody holds, by group and in total.
  waiting: GroupCounts & { total: number };
  // The group the button would take from; null shows that nothing is waiting.
  next: QueueGroup | null;
  // The case the viewer holds, if any: the button continues it.
  held: { caseId: string | null } | null;
  busy: boolean;
  error: string | null;
  onTake: () => void;
}

// PE-249: the only way to start a review. The physician holds one case at a time, so while they hold one the button
// continues it.
export function NextCasePanel({ reviewed, waiting, next, held, busy, error, onTake }: Props) {
  const label = held ? `Continue case ${held.caseId ?? ""}`.trim() : "Review next case";
  return (
    <Stack
      direction={{ xs: "column", md: "row" }}
      spacing={2}
      justifyContent="space-between"
      alignItems={{ xs: "stretch", md: "flex-start" }}
      data-testid="next-case-panel"
    >
      <Stack spacing={1} sx={{ minWidth: 0 }}>
        <Box>
          <Button
            variant="contained"
            size="large"
            endIcon={busy ? <CircularProgress size={18} color="inherit" /> : <ArrowForwardIcon />}
            disabled={busy || (!held && waiting.total === 0)}
            onClick={onTake}
            data-testid="next-case-button"
            sx={{ px: 3, py: 1.25, fontSize: "1.05rem", fontWeight: 700 }}
          >
            {label}
          </Button>
        </Box>
        <Typography variant="body2" color="text.secondary">
          Opens the oldest waiting case from the group you have reviewed least today.
        </Typography>
        {error && (
          <Alert severity="error" data-testid="next-case-error">
            Could not take a case: {error}
          </Alert>
        )}
      </Stack>
      <Paper variant="outlined" sx={{ px: 2, py: 1.5, flexShrink: 0 }} data-testid="reviewed-today">
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Reviewed today
        </Typography>
        <Stack direction="row" spacing={2} sx={{ flexWrap: "wrap", rowGap: 1, mb: 1 }}>
          {QUEUE_GROUPS.map((group) => (
            <Stack key={group} direction="row" spacing={0.75} alignItems="center" data-testid="reviewed-today-chip">
              {reviewed[group] > 0 ? (
                <CheckIcon fontSize="small" sx={{ color: "success.main" }} aria-hidden />
              ) : (
                <Typography component="span" color="text.secondary" aria-hidden>
                  –
                </Typography>
              )}
              <QueueGroupBadge value={group} />
              <Typography component="span" sx={{ fontWeight: 600, color: "text.primary" }}>
                {reviewed[group]}
              </Typography>
            </Stack>
          ))}
        </Stack>
        <Typography variant="body2" color="text.secondary" data-testid="next-case-group">
          {next ? `Next case will be a ${next} case.` : "No cases are waiting for review."}
        </Typography>
      </Paper>
    </Stack>
  );
}
