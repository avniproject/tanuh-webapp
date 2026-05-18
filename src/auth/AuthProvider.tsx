import { useEffect, useState, type ReactNode } from "react";
import { bindIdp, fetchIdpDetails, http } from "./httpClient";
import { createIdpClient } from "./IdpFactory";
import type { IdpDetails } from "./IdpDetails";
import type { IdpClient } from "./IdpClient";
import { AuthContext, type AuthState, type MeResponse } from "./authContext";

async function loadMe(): Promise<MeResponse> {
  const response = await http.get<MeResponse>("/me");
  return response.data;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });
  const [idp, setIdp] = useState<IdpClient | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const details = await fetchIdpDetails<IdpDetails>();
        const client = createIdpClient(details);
        bindIdp(client);
        const restored = await client.tryRestoreSession();
        if (cancelled) return;
        setIdp(client);
        if (restored) {
          const user = await loadMe();
          if (!cancelled) setState({ status: "ready", idp: client, user });
        } else {
          setState({ status: "needs_login", idp: client });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown auth error";
        if (!cancelled) setState({ status: "error", message });
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
