import { BrowserRouter, Route, Routes, Navigate, useLocation, useNavigate } from "react-router-dom";
import { CssBaseline, ThemeProvider, Tab, Tabs, Box, Button, CircularProgress } from "@mui/material";
import { theme } from "@/theme";
import { AuthProvider } from "@/auth/AuthProvider";
import { useAuth } from "@/auth/authContext";
import { AppShell } from "@/components/AppShell";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ReviewListPage } from "@/pages/ReviewListPage";
import { ReviewDetail } from "@/pages/ReviewDetail";
import { NotAuthorized } from "@/pages/NotAuthorized";
import { LoginPage } from "@/pages/LoginPage";
import { isPhysician } from "@/auth/roles";

function ListLayout({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const value = pathname.startsWith("/completed") ? "completed" : "pending";
  return (
    <Box>
      <Tabs
        value={value}
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
        sx={{
          mb: 2,
          "& .MuiTab-root": {
            fontWeight: 600,
            color: "text.primary",
            opacity: 0.85,
            minHeight: 48,
            fontSize: { xs: "0.85rem", sm: "0.9rem" },
            textTransform: "none",
          },
          "& .MuiTab-root.Mui-selected": {
            fontWeight: 700,
            color: "text.primary",
            opacity: 1,
          },
        }}
        onChange={(_, v) => navigate(v === "pending" ? "/pending" : "/completed")}
      >
        <Tab label="Pending Reviews" value="pending" />
        <Tab label="Completed Reviews" value="completed" />
      </Tabs>
      {children}
    </Box>
  );
}

function GatedRoutes() {
  const { state } = useAuth();

  if (state.status === "loading") {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", height: "60vh" }}>
        <CircularProgress />
      </Box>
    );
  }
  if (state.status === "error") {
    return (
      <Box sx={{ p: 3, color: "error.main" }}>
        Auth failed: {state.message}. Reload to try again.
      </Box>
    );
  }
  if (state.status === "needs_login") {
    return <LoginPage />;
  }
  if (!isPhysician(state.user)) {
    return <NotAuthorized />;
  }
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/pending" replace />} />
        <Route
          path="/pending"
          element={
            <ListLayout>
              <ReviewListPage mode="pending" />
            </ListLayout>
          }
        />
        <Route
          path="/completed"
          element={
            <ListLayout>
              <ReviewListPage mode="completed" />
            </ListLayout>
          }
        />
        <Route
          path="/review/:encounterUuid"
          element={
            // Scoped boundary: a review whose data breaks rendering degrades to
            // this message while the list tabs keep working. "Back to reviews"
            // is a full navigation on purpose — it also resets the boundary.
            <ErrorBoundary
              title="This review can't be displayed."
              description="The rest of the app still works. Reload to try again, or go back to the review list and report this case to your administrator."
              action={<Button href="/pending">Back to reviews</Button>}
            >
              <ReviewDetail />
            </ErrorBoundary>
          }
        />
        <Route path="*" element={<Navigate to="/pending" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {/* Outside the router and auth provider so a crash in either is caught;
          inside the theme so the fallback is styled. */}
      <ErrorBoundary>
        <BrowserRouter>
          <AuthProvider>
            <GatedRoutes />
          </AuthProvider>
        </BrowserRouter>
      </ErrorBoundary>
    </ThemeProvider>
  );
}
