import { AppBar, Avatar, Box, Button, Stack, Toolbar, Typography } from "@mui/material";
import { Outlet, useNavigate } from "react-router-dom";
import tanuhLogo from "@/assets/TANUH.svg";
import { useAuth } from "@/auth/authContext";

export function AppShell() {
  const navigate = useNavigate();
  const { state, signOut } = useAuth();
  const username = state.status === "ready" ? state.user.name || state.user.username : "";

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <AppBar position="sticky" color="default" elevation={0} sx={{ bgcolor: "white", borderBottom: "1px solid #e5e7eb" }}>
        <Toolbar>
          <Stack direction="row" alignItems="center" spacing={1.5} sx={{ cursor: "pointer" }} onClick={() => navigate("/")}>
            <Box component="img" src={tanuhLogo} alt="Tanuh" sx={{ height: 32 }} />
            <Typography variant="h6" color="primary">
              Physician Review
            </Typography>
          </Stack>
          <Box sx={{ flexGrow: 1 }} />
          {username && (
            <Stack direction="row" alignItems="center" spacing={1.5}>
              <Avatar sx={{ width: 28, height: 28, fontSize: 14 }}>{username.charAt(0).toUpperCase()}</Avatar>
              <Typography variant="body2">{username}</Typography>
              <Button size="small" onClick={signOut}>
                Sign out
              </Button>
            </Stack>
          )}
        </Toolbar>
      </AppBar>
      <Box component="main" sx={{ p: 3, maxWidth: 1200, mx: "auto" }}>
        <Outlet />
      </Box>
    </Box>
  );
}
