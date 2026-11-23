import { AppBar, Avatar, Box, Button, Link, Stack, Toolbar, Typography } from "@mui/material";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import tanuhLogo from "@/assets/logo.png";
import { useAuth } from "@/auth/authContext";
import { PROGRAMMES, allocatedProgrammes, programmeOfPath } from "@/auth/programmes";
import { isProgrammeManager } from "@/auth/roles";
import { CR } from "@/theme/tokens";

export function AppShell() {
  const navigate = useNavigate();
  const { state, signOut } = useAuth();
  const { pathname } = useLocation();
  const username = state.status === "ready" ? state.user.name || state.user.username : "";
  // The Data Quality screens are wider than the review screens, and a user who may open both
  // gets a link to each in the header.
  const dataQuality = pathname.startsWith("/data-quality");
  const programmes = state.status === "ready" ? allocatedProgrammes(state.user) : [];
  const programmeManager = state.status === "ready" && isProgrammeManager(state.user);
  const active = programmeOfPath(pathname);
  // The breast screens are drawn on the Clinician Review design's page colour and width.
  const breast = active === "breast";
  // Each module opens directly; someone with more than one section gets a switch in the header.
  const sections = [
    ...programmes.map((key) => ({ label: PROGRAMMES[key].name, to: PROGRAMMES[key].home, on: active === key })),
    ...(programmeManager ? [{ label: "Data Quality", to: "/data-quality", on: dataQuality }] : []),
  ];
  const title = dataQuality ? "Data Quality" : "Clinician Review";

  return (
    <Box
      sx={{
        minHeight: "100vh",
        bgcolor: breast ? CR.page : "background.default",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <AppBar
        position="sticky"
        color="default"
        elevation={0}
        sx={{
          background: `linear-gradient(90deg, ${CR.headerFrom}, ${CR.headerTo})`,
          color: "#fff",
          fontFamily: CR.font,
        }}
      >
        <Toolbar sx={{ minHeight: { xs: 56, sm: 72 }, gap: 1, px: { xs: 1.5, sm: 3 } }}>
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
              sx={{
                height: { xs: 40, sm: 48 },
                width: "auto",
                flexShrink: 0,
                bgcolor: "#fff",
                borderRadius: "10px",
                p: 0.25,
              }}
            />
            <Typography
              variant="h5"
              sx={{
                fontFamily: CR.font,
                color: "#fff",
                fontWeight: 500,
                fontSize: { xs: "1rem", sm: "1.5rem" },
                display: { xs: "none", sm: "block" },
              }}
            >
              {title}
            </Typography>
          </Stack>
          {sections.length > 1 && (
            <Stack direction="row" spacing={1} sx={{ ml: { xs: 1, sm: 3 }, flexWrap: "wrap" }}>
              {sections.map((section) => (
                <Button
                  key={section.to}
                  size="small"
                  variant={section.on ? "outlined" : "text"}
                  aria-current={section.on ? "page" : undefined}
                  onClick={() => navigate(section.to)}
                  sx={{
                    fontFamily: CR.font,
                    color: "#fff",
                    borderColor: "rgba(255,255,255,.6)",
                    borderRadius: CR.radius.pill,
                    "&:hover": { borderColor: "#fff", bgcolor: "rgba(255,255,255,.08)" },
                  }}
                >
                  {section.label}
                </Button>
              ))}
            </Stack>
          )}
          <Box sx={{ flexGrow: 1 }} />
          {username && (
            <Stack direction="row" alignItems="center" spacing={{ xs: 0.5, sm: 1.5 }}>
              <Avatar sx={{ width: 36, height: 36, fontSize: 15, bgcolor: CR.avatar, color: CR.avatarText, fontWeight: 600 }}>{username.charAt(0).toUpperCase()}</Avatar>
              <Typography variant="body2" sx={{ display: { xs: "none", sm: "block" }, fontFamily: CR.font, fontWeight: 600 }}>
                {username}
              </Typography>
              <Button
                size="small"
                variant="outlined"
                onClick={signOut}
                sx={{
                  fontFamily: CR.font,
                  color: "#fff",
                  borderColor: "rgba(255,255,255,.6)",
                  borderRadius: CR.radius.pill,
                  px: 2,
                  "&:hover": { borderColor: "#fff", bgcolor: "rgba(255,255,255,.08)" },
                }}
              >
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
          maxWidth: dataQuality ? 1600 : breast ? 1280 : 1200,
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
