import { useState, type FormEvent, type ReactNode } from "react";
import { Alert, Box, Button, Card, CardContent, Link, Stack, TextField, Typography } from "@mui/material";
import tanuhLogo from "@/assets/logo.png";
import { useAuth } from "@/auth/authContext";

type View = "SIGN_IN" | "FORGOT_PASSWORD" | "CONFIRM_RESET";

export function LoginPage() {
  const { state } = useAuth();
  const [view, setView] = useState<View>("SIGN_IN");
  const [resetUsername, setResetUsername] = useState("");

  if (state.status !== "needs_login") return null;

  // Keycloak redirects to its hosted login (handles its own reset flow).
  if (!state.idp.needsCredentialForm) {
    return (
      <CenteredCard>
        <Typography>Redirecting to sign-in…</Typography>
      </CenteredCard>
    );
  }

  return (
    <CenteredCard>
      <Stack spacing={2} alignItems="center" sx={{ mb: 3 }}>
        <Box component="img" src={tanuhLogo} alt="Tanuh" sx={{ height: 58 }} />
        <Typography variant="h6">Clinician Review</Typography>
      </Stack>

      {view === "SIGN_IN" && (
        <SignInView
          onForgot={() => setView("FORGOT_PASSWORD")}
          showForgotLink={state.idp.supportsPasswordReset}
        />
      )}
      {view === "FORGOT_PASSWORD" && (
        <ForgotPasswordView
          onSent={(username) => {
            setResetUsername(username);
            setView("CONFIRM_RESET");
          }}
          onCancel={() => setView("SIGN_IN")}
        />
      )}
      {view === "CONFIRM_RESET" && (
        <ConfirmResetView
          initialUsername={resetUsername}
          onDone={() => setView("SIGN_IN")}
          onCancel={() => setView("SIGN_IN")}
        />
      )}
    </CenteredCard>
  );
}

function SignInView({ onForgot, showForgotLink }: { onForgot: () => void; showForgotLink: boolean }) {
  const { signIn } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signIn(username.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={onSubmit}>
      <Stack spacing={2}>
        {error && <Alert severity="error">{error}</Alert>}
        <TextField
          label="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus
          autoComplete="username"
          required
        />
        <TextField
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
        <Button type="submit" variant="contained" disabled={submitting || !username || !password}>
          {submitting ? "Signing in…" : "Sign in"}
        </Button>
        {showForgotLink && (
          <Box sx={{ textAlign: "right" }}>
            <Link component="button" type="button" onClick={onForgot} underline="hover">
              Forgot password?
            </Link>
          </Box>
        )}
      </Stack>
    </form>
  );
}

function ForgotPasswordView({
  onSent,
  onCancel,
}: {
  onSent: (username: string) => void;
  onCancel: () => void;
}) {
  const { requestPasswordReset } = useAuth();
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await requestPasswordReset(username.trim());
      onSent(username.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={onSubmit}>
      <Stack spacing={2}>
        <Typography variant="body2">
          Enter your username. We'll send a verification code to the email on file.
        </Typography>
        {error && <Alert severity="error">{error}</Alert>}
        <TextField
          label="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus
          autoComplete="username"
          required
        />
        <Button type="submit" variant="contained" disabled={submitting || !username}>
          {submitting ? "Sending…" : "Send code"}
        </Button>
        <Button onClick={onCancel} disabled={submitting}>
          Back to sign in
        </Button>
      </Stack>
    </form>
  );
}

function ConfirmResetView({
  initialUsername,
  onDone,
  onCancel,
}: {
  initialUsername: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { confirmPasswordReset } = useAuth();
  const [username, setUsername] = useState(initialUsername);
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    setSubmitting(true);
    try {
      await confirmPasswordReset(username.trim(), code.trim(), newPassword);
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <Stack spacing={2}>
        <Alert severity="success">Password reset. You can now sign in with your new password.</Alert>
        <Button variant="contained" onClick={onDone}>
          Back to sign in
        </Button>
      </Stack>
    );
  }

  return (
    <form onSubmit={onSubmit}>
      <Stack spacing={2}>
        <Typography variant="body2">
          Enter the verification code we emailed you, then choose a new password.
        </Typography>
        {error && <Alert severity="error">{error}</Alert>}
        <TextField
          label="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          required
        />
        <TextField
          label="Verification code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoFocus
          inputMode="numeric"
          autoComplete="one-time-code"
          required
        />
        <TextField
          label="New password"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password"
          required
        />
        <TextField
          label="Confirm new password"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          autoComplete="new-password"
          required
        />
        <Button type="submit" variant="contained" disabled={submitting || !username || !code || !newPassword}>
          {submitting ? "Resetting…" : "Reset password"}
        </Button>
        <Button onClick={onCancel} disabled={submitting}>
          Back to sign in
        </Button>
      </Stack>
    </form>
  );
}

function CenteredCard({ children }: { children: ReactNode }) {
  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        bgcolor: "background.default",
      }}
    >
      <Card variant="outlined" sx={{ width: 400, maxWidth: "92vw" }}>
        <CardContent sx={{ p: 4 }}>{children}</CardContent>
      </Card>
    </Box>
  );
}
