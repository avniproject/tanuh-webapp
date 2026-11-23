import { Box, Button, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { PROGRAMMES, landingPath, type ProgrammeKey } from "@/auth/programmes";
import { CR } from "@/theme/tokens";

/** Shows its screens only to a clinician allocated the programme; anyone else gets the reason. */
export function ProgrammeGuard({
  programme,
  allocated,
  children,
}: {
  programme: ProgrammeKey;
  allocated: ProgrammeKey[];
  children: ReactNode;
}) {
  const navigate = useNavigate();
  if (allocated.includes(programme)) return <>{children}</>;
  const landing = landingPath(allocated);
  const landingName = allocated.length ? PROGRAMMES[allocated[0]].name : null;
  return (
    <Box sx={{ display: "grid", placeItems: "center", py: 8, px: 2, fontFamily: CR.font }}>
      <Stack
        spacing={2}
        alignItems="center"
        sx={{
          maxWidth: 520,
          textAlign: "center",
          bgcolor: CR.surface,
          border: `1px solid ${CR.border}`,
          borderRadius: CR.radius.card,
          p: 5,
        }}
      >
        <Typography sx={{ fontFamily: CR.font, fontSize: 22, fontWeight: 600, color: CR.heading }}>
          You don't have access to {PROGRAMMES[programme].name}
        </Typography>
        <Typography sx={{ fontFamily: CR.font, color: CR.textSecondary }}>
          This module is not allocated to your account. Ask your programme coordinator to add it to your Avni account.
        </Typography>
        <Button
          variant="contained"
          disableElevation
          onClick={() => navigate(landing, { replace: true })}
          sx={{
            fontFamily: CR.font,
            borderRadius: CR.radius.pill,
            bgcolor: CR.brand,
            px: 3,
            "&:hover": { bgcolor: CR.brandPressed },
          }}
        >
          {landingName ? `Go to ${landingName}` : "Back"}
        </Button>
      </Stack>
    </Box>
  );
}
