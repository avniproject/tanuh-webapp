import { Amplify } from "aws-amplify";
import {
  confirmResetPassword,
  fetchAuthSession,
  getCurrentUser,
  resetPassword,
  signIn,
  signOut,
} from "aws-amplify/auth";
import type { AxiosInstance } from "axios";
import type { CognitoDetails } from "./IdpDetails";
import { AUTH_TOKEN_KEY } from "./IdpDetails";
import type { IdpClient } from "./IdpClient";

export class CognitoClient implements IdpClient {
  readonly needsCredentialForm = true;
  readonly supportsPasswordReset = true;
  private username: string | null = null;
  private cachedToken: { value: string; expiresAt: number } | null = null;

  constructor(details: CognitoDetails) {
    Amplify.configure({
      Auth: {
        Cognito: {
          userPoolId: details.poolId,
          userPoolClientId: details.clientId,
          loginWith: { username: true },
        },
      },
    });
  }

  async tryRestoreSession(): Promise<boolean> {
    try {
      const user = await getCurrentUser();
      this.username = user.username;
      await this.getToken();
      return true;
    } catch {
      return false;
    }
  }

  async signIn(username?: string, password?: string): Promise<void> {
    if (!username || !password) throw new Error("Username and password are required");
    const result = await signIn({ username, password });
    if (!result.isSignedIn) {
      const step = result.nextStep?.signInStep;
      throw new Error(
        step === "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED"
          ? "Password reset required. Sign in via the main Avni webapp first to set a new password."
          : `Additional sign-in step required: ${step}`,
      );
    }
    this.username = username;
    await this.getToken();
  }

  private async getToken(): Promise<string> {
    const now = Date.now();
    // Skip the network round-trip on every request — Amplify caches the
    // session internally too, but fetchAuthSession() is still measurable.
    if (this.cachedToken && this.cachedToken.expiresAt - now > 30_000) {
      return this.cachedToken.value;
    }
    const session = await fetchAuthSession();
    const idToken = session.tokens?.idToken;
    const token = idToken?.toString();
    if (!token) throw new Error("NO_ID_TOKEN");
    const exp = idToken?.payload?.exp;
    this.cachedToken = { value: token, expiresAt: typeof exp === "number" ? exp * 1000 : now + 5 * 60_000 };
    localStorage.setItem(AUTH_TOKEN_KEY, token);
    return token;
  }

  async attachAuthHeader(axios: AxiosInstance): Promise<void> {
    const token = await this.getToken();
    axios.defaults.headers.common["AUTH-TOKEN"] = token;
  }

  async signOut(): Promise<void> {
    await signOut();
    localStorage.removeItem(AUTH_TOKEN_KEY);
    this.cachedToken = null;
    this.username = null;
  }

  getUsername(): string | null {
    return this.username;
  }

  async requestPasswordReset(username: string): Promise<void> {
    if (!username) throw new Error("Username is required");
    await resetPassword({ username });
  }

  async confirmPasswordReset(username: string, code: string, newPassword: string): Promise<void> {
    if (!username || !code || !newPassword) throw new Error("Username, code and new password are required");
    await confirmResetPassword({ username, confirmationCode: code, newPassword });
  }
}
