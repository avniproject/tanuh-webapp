import type { ReactNode } from "react";
import { Alert, Box, Card, CardContent, Grid, Stack, Typography } from "@mui/material";
import { signalDetailsOf } from "@/api/signalDetails";
import type { EncounterApiResponse } from "@/api/types";
import { QUEUE_GROUP_COLOURS } from "./queueGroupColours";

const AI_DISCLAIMER =
  "AI results are decision support only and are not a diagnosis. The final clinical assessment rests with the clinician.";
const SAFETY_LINE = "All three signals were negative. This case was picked at random for the 5% check.";

function Row({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <Box sx={{ display: "flex", gap: 2, mt: 0.5 }}>
      <Typography variant="body2" color="text.secondary" sx={{ flex: "0 0 40%" }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ flex: 1 }} data-testid={testId}>
        {value}
      </Typography>
    </Box>
  );
}

function SignalCard({
  title,
  value,
  valueColor,
  testId,
  children,
}: {
  title: string;
  value: string;
  valueColor?: string;
  testId: string;
  children?: ReactNode;
}) {
  return (
    <Card variant="outlined" sx={{ height: "100%" }} data-testid={testId}>
      <CardContent>
        <Typography variant="subtitle2" component="h3" fontWeight={700}>
          {title}
        </Typography>
        <Typography variant="h6" component="p" fontWeight={700} sx={{ color: valueColor ?? "text.primary" }}>
          {value}
        </Typography>
        {children}
      </CardContent>
    </Card>
  );
}

// PE-250: the three screening signals side by side, the OCSHR status on its own line, the safety label and the AI
// disclaimer. Shown only where the review queue is on (see ReviewForm).
export function ScreeningSignals({ screening }: { screening: EncounterApiResponse }) {
  const { flw, edge, ocshr, safetySample } = signalDetailsOf(screening);
  const dash = "—";
  const ocshrColor = ocshr.state === "scored" ? (ocshr.highRisk ? "error.main" : undefined) : "text.secondary";
  const safety = QUEUE_GROUP_COLOURS["Safety sample"];

  return (
    <Card variant="outlined" data-testid="screening-signals">
      <CardContent>
        <Typography variant="h6" component="h2" fontWeight={700} sx={{ mb: 2 }}>
          Screening signals
        </Typography>
        <Grid container spacing={2} alignItems="stretch">
          <Grid size={{ xs: 12, md: 4 }}>
            <SignalCard title="FLW assessment" value={flw.verdict ?? dash} testId="signal-flw">
              <Row label="Referral raised" value={flw.referralRaised ? "Yes" : "No"} />
            </SignalCard>
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <SignalCard
              title="Edge AI classification"
              value={edge.verdict ?? dash}
              valueColor={edge.verdict === "Suspicious" ? QUEUE_GROUP_COLOURS["AI marked"].ink : undefined}
              testId="signal-edge"
            >
              {edge.flagged && <Row label="Images flagged" value={`${edge.flagged.suspicious} of ${edge.flagged.of}`} />}
            </SignalCard>
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <SignalCard title="OCSHR model result" value={ocshr.resultText} valueColor={ocshrColor} testId="signal-ocshr">
              {ocshr.probability && <Row label="Probability" value={ocshr.probability} />}
              {ocshr.version && <Row label="Model version" value={ocshr.version} />}
              <Row label="Status" value={ocshr.statusLine} testId="ocshr-status" />
            </SignalCard>
          </Grid>
        </Grid>
        {safetySample && (
          <Stack spacing={0.5} alignItems="flex-start" sx={{ mt: 2 }}>
            <Box
              data-testid="safety-review-label"
              sx={{
                px: 1.5,
                py: 0.25,
                borderRadius: 999,
                fontSize: 13,
                fontWeight: 600,
                color: safety.ink,
                bgcolor: safety.fill,
              }}
            >
              Selected for safety review
            </Box>
            <Typography variant="body2" color="text.secondary">
              {SAFETY_LINE}
            </Typography>
          </Stack>
        )}
        <Alert severity="info" sx={{ mt: 2 }} data-testid="ai-disclaimer">
          {AI_DISCLAIMER}
        </Alert>
      </CardContent>
    </Card>
  );
}
