import { Box, Button, Stack, Typography } from "@mui/material";
import { useAuth } from "@/auth/authContext";
import { CR } from "@/theme/tokens";

export function NoProgramme() {
  const { signOut } = useAuth();
  return (
    <Box sx={{ display: "grid", placeItems: "center", py: 8, px: 2 }}>
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
          No programme module allocated yet
        </Typography>
        <Typography sx={{ fontFamily: CR.font, color: CR.textSecondary }}>
          Your account is not in a clinician group for any screening programme. Ask your programme coordinator to add
          you to one in Avni, then sign in again.
        </Typography>
        <Button
          variant="outlined"
          onClick={signOut}
          sx={{ fontFamily: CR.font, borderRadius: CR.radius.pill, borderColor: CR.brand, color: CR.heading, px: 3 }}
        >
          Sign out
        </Button>
      </Stack>
    </Box>
  );
}
