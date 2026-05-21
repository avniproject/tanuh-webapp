import { useEffect, useState, type ReactNode } from "react";
import axios from "axios";
import { bindIdp, fetchIdpDetails, http } from "./httpClient";
import { createIdpClient } from "./IdpFactory";
import type { IdpDetails } from "./IdpDetails";
import type { IdpClient } from "./IdpClient";
import { AuthContext, type AuthState, type MeResponse } from "./authContext";
import { clearCatchmentCache } from "@/api/impl";

async function loadMe(): Promise<MeResponse> {
  const response = await http.get<MeResponse>("/me");
  return response.data;
}

function isUnauthorized(err: unknown): boolean {
  return axios.isAxiosError(err) && err.response?.status === 401;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });
  const [idp, setIdp] = useState<IdpClient | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      let client: IdpClient | null = null;
      try {
        const details = await fetchIdpDetails<IdpDetails>();
        client = createIdpClient(details);
        bindIdp(client);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Unknown auth error";
        setState({ status: "error", message });
        return;
      }

      if (cancelled) return;
      setIdp(client);

      let restored = false;
      try {
        restored = await client.tryRestoreSession();
      } catch {
        // Treat unexpected restore failures as "needs login" rather than a
        // fatal error — the user has a working path forward via the login form.
        restored = false;
      }
      if (cancelled) return;

      if (!restored) {
        setState({ status: "needs_login", idp: client });
        return;
      }

      try {
        const user = await loadMe();
        if (!cancelled) setState({ status: "ready", idp: client, user });
      } catch (err) {
        if (cancelled) return;
        if (isUnauthorized(err)) {
          // Session restored but the server rejected the token (expired /
          // revoked). Clear local state quietly and drop to the login form.
          try {
            await client.signOut();
          } catch {
            // signOut failures are not actionable here.
          }
          if (!cancelled) setState({ status: "needs_login", idp: client });
        } else {
          const message = err instanceof Error ? err.message : "Unknown auth error";
          setState({ status: "error", message });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = async (username: string, password: string) => {
    if (!idp) throw new Error("IDP not initialised");
    await idp.signIn(username, password);
    const user = await loadMe();
    setState({ status: "ready", idp, user });
  };

  const signOut = async () => {
    if (state.status === "ready") {
      clearCatchmentCache();
      await state.idp.signOut();
      setState({ status: "loading" });
      window.location.reload();
    }
  };

  const requestPasswordReset = async (username: string) => {
    if (!idp) throw new Error("IDP not initialised");
    await idp.requestPasswordReset(username);
  };

  const confirmPasswordReset = async (username: string, code: string, newPassword: string) => {
    if (!idp) throw new Error("IDP not initialised");
    await idp.confirmPasswordReset(username, code, newPassword);
  };

  return (
    <AuthContext.Provider value={{ state, signIn, signOut, requestPasswordReset, confirmPasswordReset }}>
      {children}
    </AuthContext.Provider>
  );
}
