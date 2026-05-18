import { createContext, useContext } from "react";
import type { IdpClient } from "./IdpClient";

export interface UserGroupEntry {
  uuid: string;
  groupUuid: string;
  groupName: string;
  voided: boolean;
}

export interface MeResponse {
  userUUID: string;
  username: string;
  name: string;
  organisationName?: string;
  organisationId?: number;
  catchmentName?: string;
  myUserGroups?: UserGroupEntry[];
}

export type AuthState =
  | { status: "loading" }
  | { status: "needs_login"; idp: IdpClient }
  | { status: "ready"; idp: IdpClient; user: MeResponse }
  | { status: "error"; message: string };

export interface AuthContextValue {
  state: AuthState;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  requestPasswordReset: (username: string) => Promise<void>;
  confirmPasswordReset: (username: string, code: string, newPassword: string) => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
