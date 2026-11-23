import { lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes, Navigate, useLocation, useNavigate } from "react-router-dom";
import { CssBaseline, ThemeProvider, Tab, Tabs, Box, Button, CircularProgress } from "@mui/material";
import { theme } from "@/theme";
import { AuthProvider } from "@/auth/AuthProvider";
import { useAuth } from "@/auth/authContext";
import { AppShell } from "@/components/AppShell";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ReviewListPage } from "@/pages/ReviewListPage";
import { ReviewDetail } from "@/pages/ReviewDetail";
import { CaseDetail } from "@/pages/CaseDetail";
import { LoginPage } from "@/pages/LoginPage";
import { allocatedProgrammes, landingPath } from "@/auth/programmes";
import { isProgrammeManager } from "@/auth/roles";
import { ProgrammeGuard } from "@/components/ProgrammeGuard";
import { NoProgramme } from "@/pages/NoProgramme";
import { BreastListPage } from "@/pages/BreastListPage";
import { DataQualityLayout } from "@/dataQuality/DataQualityLayout";
import { Dimensions } from "@/dataQuality/views/Dimensions";
import { Guide } from "@/dataQuality/views/Guide";
import { HealthCheck } from "@/dataQuality/views/HealthCheck";
import { Workers } from "@/dataQuality/views/Workers";

// The woman's page brings Avni's rule libraries with it, so it loads only when it is opened.
const BreastWomanPage = lazy(() => import("@/pages/BreastWomanPage").then((m) => ({ default: m.BreastWomanPage })));

function Loading() {
  return (
    <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", height: "60vh" }}>
      <CircularProgress />
    </Box>
  );
}

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
  // A clinician's programme modules come from their Avni user groups (Physician: oral, Breast
  // Cancer Clinician: breast); programme managers see the Data Quality screens. The app opens on
  // the first allocated programme.
  const programmes = allocatedProgrammes(state.user);
  const programmeManager = isProgrammeManager(state.user);
  if (programmes.length === 0 && !programmeManager) {
    return <NoProgramme />;
  }
  const home = programmes.length ? landingPath(programmes) : "/data-quality/health";
  const oral = (screen: React.ReactNode) => (
    <ProgrammeGuard programme="oral" allocated={programmes} home={home}>
      {screen}
    </ProgrammeGuard>
  );
  const breast = (screen: React.ReactNode) => (
    <ProgrammeGuard programme="breast" allocated={programmes} home={home}>
      <ErrorBoundary
        title="This screen can't be displayed."
        description="The rest of the app still works. Reload to try again, or report this to your administrator."
        action={<Button href="/breast">Back to the list</Button>}
      >
        <Suspense fallback={<Loading />}>{screen}</Suspense>
      </ErrorBoundary>
    </ProgrammeGuard>
  );
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to={home} replace />} />
        <Route path="/no-programme" element={<NoProgramme />} />
        <Route
          path="/pending"
          element={oral(
            <ListLayout>
              <ReviewListPage mode="pending" />
            </ListLayout>,
          )}
        />
        <Route
          path="/completed"
          element={oral(
            <ListLayout>
              <ReviewListPage mode="completed" />
            </ListLayout>,
          )}
        />
        <Route
          path="/review/:encounterUuid"
          element={oral(
            // Scoped boundary: a review whose data breaks rendering degrades to
            // this message while the list tabs keep working. "Back to reviews"
            // is a full navigation on purpose — it also resets the boundary.
            <ErrorBoundary
              title="This review can't be displayed."
              description="The rest of the app still works. Reload to try again, or go back to the review list and report this case to your administrator."
              action={<Button href="/pending">Back to reviews</Button>}
            >
              <ReviewDetail />
            </ErrorBoundary>,
          )}
        />
        <Route
          path="/case/:screeningUuid"
          element={oral(
            <ErrorBoundary
              title="This case can't be displayed."
              description="The rest of the app still works. Reload to try again, or go back to the review list and report this case to your administrator."
              action={<Button href="/pending">Back to reviews</Button>}
            >
              <CaseDetail />
            </ErrorBoundary>,
          )}
        />
        <Route path="/breast" element={breast(<BreastListPage />)} />
        <Route path="/breast/woman/:screeningUuid" element={breast(<BreastWomanPage />)} />
        {programmeManager && (
          <Route
            path="/data-quality"
            element={
              <ErrorBoundary
                title="Data Quality can't be displayed."
                description="The rest of the app still works. Reload to try again, or report this to your administrator."
              >
                <DataQualityLayout />
              </ErrorBoundary>
            }
          >
            <Route index element={<Navigate to="health" replace />} />
            <Route path="health" element={<HealthCheck />} />
            <Route path="workers" element={<Workers />} />
            <Route path="dimensions" element={<Dimensions />} />
            <Route path="guide" element={<Guide />} />
          </Route>
        )}
        <Route path="*" element={<Navigate to={home} replace />} />
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
