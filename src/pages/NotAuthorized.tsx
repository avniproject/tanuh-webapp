import { Box, Button, Stack, Typography } from "@mui/material";
import { useAuth } from "@/auth/authContext";

export function NotAuthorized() {
  const { signOut } = useAuth();
  return (
    <Box sx={{ textAlign: "center", py: 8 }}>
      <Stack spacing={2} alignItems="center">
        <Typography variant="h5">Not authorised</Typography>
        <Typography color="text.secondary" sx={{ maxWidth: 480 }}>
          Your account does not have the Physician role. If you believe this is wrong, contact your administrator.
        </Typography>
        <Button variant="outlined" onClick={signOut}>
          Sign out
        </Button>
      </Stack>
    </Box>
  );
}
