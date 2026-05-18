import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { CssBaseline, ThemeProvider, Tab, Tabs, Box, CircularProgress } from "@mui/material";
import { theme } from "@/theme";
import { AuthProvider } from "@/auth/AuthProvider";
import { useAuth } from "@/auth/authContext";
import { AppShell } from "@/components/AppShell";
import { ReviewListPage } from "@/pages/ReviewListPage";
import { ReviewDetail } from "@/pages/ReviewDetail";
import { NotAuthorized } from "@/pages/NotAuthorized";
import { LoginPage } from "@/pages/LoginPage";
import { isPhysician } from "@/auth/roles";

function ListLayout({ children }: { children: React.ReactNode }) {
  const path = window.location.pathname;
  const value = path.startsWith("/completed") ? "completed" : "pending";
  return (
    <Box>
      <Tabs
        value={value}
        sx={{ mb: 2 }}
        onChange={(_, v) => {
          window.location.assign(v === "pending" ? "/pending" : "/completed");
        }}
      >
        <Tab label="Pending Reviews" value="pending" />
        <Tab label="Previously Completed Reviews" value="completed" />
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
        <Route path="/review/:encounterUuid" element={<ReviewDetail />} />
        <Route path="*" element={<Navigate to="/pending" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <AuthProvider>
          <GatedRoutes />
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
}
