import type { AxiosInstance } from "axios";

export interface IdpClient {
  // True for Cognito (in-app form), false for Keycloak (hosted login page).
  readonly needsCredentialForm: boolean;
  readonly supportsPasswordReset: boolean;

  // Resolves true on a valid existing session, false if interactive sign-in
  // is required. Keycloak may redirect during this call.
  tryRestoreSession(): Promise<boolean>;

  // For Keycloak the credential args are ignored — it redirects to its login page.
  signIn(username?: string, password?: string): Promise<void>;

  attachAuthHeader(axios: AxiosInstance): Promise<void>;
  signOut(): Promise<void>;
  getUsername(): string | null;

  // Keycloak hosts its own forgot-password flow; these throw on Keycloak.
  requestPasswordReset(username: string): Promise<void>;
  confirmPasswordReset(username: string, code: string, newPassword: string): Promise<void>;
}
