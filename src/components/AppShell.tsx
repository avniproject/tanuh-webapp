import { AppBar, Avatar, Box, Button, Link, Stack, Toolbar, Typography } from "@mui/material";
import { Outlet, useNavigate } from "react-router-dom";
import tanuhLogo from "@/assets/logo.png";
import { useAuth } from "@/auth/authContext";

export function AppShell() {
  const navigate = useNavigate();
  const { state, signOut } = useAuth();
  const username = state.status === "ready" ? state.user.name || state.user.username : "";

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default", display: "flex", flexDirection: "column" }}>
      <AppBar
        position="sticky"
        color="default"
        elevation={0}
        sx={{
          bgcolor: "white",
          borderBottom: "1px solid #e5e7eb",
          boxShadow: "0 1px 2px rgba(0, 0, 0, 0.04)",
        }}
      >
        <Toolbar sx={{ minHeight: { xs: 56, sm: 64 }, gap: 1, px: { xs: 1.5, sm: 3 } }}>
          <Stack
            direction="row"
            alignItems="center"
            spacing={{ xs: 1, sm: 2 }}
            sx={{ cursor: "pointer", minWidth: 0 }}
            onClick={() => navigate("/")}
          >
            <Box
              component="img"
              src={tanuhLogo}
              alt="Tanuh"
              sx={{ height: { xs: 44, sm: 56 }, width: "auto", flexShrink: 0 }}
            />
            <Typography
              variant="h5"
              color="primary"
              sx={{
                fontWeight: 700,
                fontSize: { xs: "1rem", sm: "1.5rem" },
                display: { xs: "none", sm: "block" },
              }}
            >
              Physician Review
            </Typography>
          </Stack>
          <Box sx={{ flexGrow: 1 }} />
          {username && (
            <Stack direction="row" alignItems="center" spacing={{ xs: 0.5, sm: 1.5 }}>
              <Avatar sx={{ width: 28, height: 28, fontSize: 14 }}>{username.charAt(0).toUpperCase()}</Avatar>
              <Typography variant="body2" sx={{ display: { xs: "none", sm: "block" } }}>
                {username}
              </Typography>
              <Button size="small" onClick={signOut}>
                Sign out
              </Button>
            </Stack>
          )}
        </Toolbar>
      </AppBar>
      <Box
        component="main"
        sx={{
          p: { xs: 1.5, sm: 3 },
          maxWidth: 1200,
          mx: "auto",
          width: "100%",
          flexGrow: 1,
          boxSizing: "border-box",
        }}
      >
        <Outlet />
      </Box>
      <Box
        component="footer"
        sx={{
          mt: "auto",
          py: 2,
          borderTop: "1px solid #e5e7eb",
          bgcolor: "white",
          textAlign: "center",
        }}
      >
        <Typography variant="body2" color="text.secondary">
          Powered by{" "}
          <Link
            href="https://avniproject.org"
            target="_blank"
            rel="noopener noreferrer"
            underline="hover"
            sx={{ fontWeight: 600 }}
          >
            Avni
          </Link>
        </Typography>
      </Box>
    </Box>
  );
}
