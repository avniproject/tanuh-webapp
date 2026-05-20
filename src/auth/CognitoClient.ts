import { Amplify } from "aws-amplify";
import {
  confirmResetPassword,
  fetchAuthSession,
  getCurrentUser,
  resetPassword,
  signIn,
  signOut,
} from "aws-amplify/auth";
import type { InternalAxiosRequestConfig } from "axios";
import type { CognitoDetails } from "./IdpDetails";
import { AUTH_TOKEN_KEY, AUTH_USERNAME_KEY } from "./IdpDetails";
import type { IdpClient } from "./IdpClient";

export class CognitoClient implements IdpClient {
  readonly needsCredentialForm = true;
  readonly supportsPasswordReset = true;
  private username: string | null = null;

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
    this.username = localStorage.getItem(AUTH_USERNAME_KEY);
  }

  async tryRestoreSession(): Promise<boolean> {
    try {
      const session = await fetchAuthSession();
      const idToken = session.tokens?.idToken;
      if (!idToken) return false;
      localStorage.setItem(AUTH_TOKEN_KEY, idToken.toString());
      try {
        const user = await getCurrentUser();
        this.setUsername(user.username);
      } catch {
        // Best effort — the session is valid, username display is non-critical.
      }
      return true;
    } catch {
      return false;
    }
  }

  async signIn(username?: string, password?: string): Promise<void> {
    if (!username || !password) throw new Error("Username and password are required");
    try {
      await this.runSignIn(username, password);
    } catch (err) {
      // Amplify v6 throws this when its local store still has an authenticated
      // user record — e.g. our restore path returned false but Amplify's cache
      // hasn't been cleared. Reset Amplify state and retry once.
      if (err instanceof Error && err.name === "UserAlreadyAuthenticatedException") {
        try {
          await signOut();
        } catch {
          // signOut failures here are not actionable — proceed to retry.
        }
        await this.runSignIn(username, password);
        return;
      }
      throw err;
    }
  }

  private async runSignIn(username: string, password: string): Promise<void> {
    const result = await signIn({ username, password });
    if (!result.isSignedIn) {
      const step = result.nextStep?.signInStep;
      throw new Error(
        step === "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED"
          ? "Password reset required. Sign in via the main Avni webapp first to set a new password."
          : `Additional sign-in step required: ${step}`,
      );
    }
    this.setUsername(username);
    await this.getToken();
  }

  private async getToken(): Promise<string> {
    const session = await fetchAuthSession();
    const token = session.tokens?.idToken?.toString();
    if (!token) throw new Error("NO_ID_TOKEN");
    localStorage.setItem(AUTH_TOKEN_KEY, token);
    return token;
  }

  async attachAuthHeader(config: InternalAxiosRequestConfig): Promise<void> {
    const token = await this.getToken();
    config.headers.set("AUTH-TOKEN", token);
  }

  async signOut(): Promise<void> {
    try {
      await signOut();
    } finally {
      localStorage.removeItem(AUTH_TOKEN_KEY);
      localStorage.removeItem(AUTH_USERNAME_KEY);
      this.username = null;
    }
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

  private setUsername(username: string): void {
    this.username = username;
    localStorage.setItem(AUTH_USERNAME_KEY, username);
  }
}
