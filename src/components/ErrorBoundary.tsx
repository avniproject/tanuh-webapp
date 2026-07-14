import { Component, type ReactNode } from "react";
import { Box, Button, Stack, Typography } from "@mui/material";

interface Props {
  children: ReactNode;
  // Shown above the recovery buttons. Defaults suit the app-level boundary;
  // scoped boundaries (e.g. around a single review) pass their own wording.
  title?: string;
  description?: string;
  // Extra recovery action rendered next to Reload (e.g. a back-to-list link).
  action?: ReactNode;
}

interface State {
  error: Error | null;
}

// React unmounts the whole tree on an uncaught render error, leaving a blank
// page with no recovery path. This boundary swaps that for a message and a
// reload. Must be a class component — error boundaries have no hook API.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <Box sx={{ p: 4, textAlign: "center" }}>
        <Stack spacing={2} alignItems="center">
          <Typography variant="h6">
            {this.props.title ?? "Something went wrong displaying this page."}
          </Typography>
          <Typography color="text.secondary" sx={{ maxWidth: 480 }}>
            {this.props.description ??
              "Your submitted work is safe on the server. Reload to try again; if this keeps happening, contact your administrator."}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ fontFamily: "monospace" }}>
            {this.state.error.message}
          </Typography>
          <Stack direction="row" spacing={1}>
            <Button variant="contained" onClick={() => window.location.reload()}>
              Reload
            </Button>
            {this.props.action}
          </Stack>
        </Stack>
      </Box>
    );
  }
}
