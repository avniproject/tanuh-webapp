import Keycloak from "keycloak-js";
import type { AxiosInstance } from "axios";
import type { KeycloakDetails } from "./IdpDetails";
import { AUTH_TOKEN_KEY } from "./IdpDetails";
import type { IdpClient } from "./IdpClient";

export class KeycloakClient implements IdpClient {
  readonly needsCredentialForm = false;
  readonly supportsPasswordReset = false;
  private kc: Keycloak;

  constructor(details: KeycloakDetails) {
    this.kc = new Keycloak({
      url: details.authServerUrl,
      realm: details.realm,
      clientId: details.clientId,
    });
  }

  async tryRestoreSession(): Promise<boolean> {
    const authenticated = await this.kc.init({
      onLoad: "login-required",
      checkLoginIframe: false,
      pkceMethod: "S256",
    });
    if (!authenticated || !this.kc.token) return false;
    localStorage.setItem(AUTH_TOKEN_KEY, this.kc.token);
    return true;
  }

  async signIn(): Promise<void> {
    await this.kc.login();
  }

  async attachAuthHeader(axios: AxiosInstance): Promise<void> {
    if (!this.kc.token) throw new Error("NOT_SIGNED_IN");
    try {
      await this.kc.updateToken(30);
    } catch {
      await this.kc.login();
      return;
    }
    axios.defaults.headers.common["AUTH-TOKEN"] = this.kc.token;
    localStorage.setItem(AUTH_TOKEN_KEY, this.kc.token);
  }

  async signOut(): Promise<void> {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    await this.kc.logout();
  }

  getUsername(): string | null {
    return (this.kc.tokenParsed as { preferred_username?: string } | undefined)?.preferred_username ?? null;
  }

  async requestPasswordReset(): Promise<void> {
    throw new Error("Use the forgot-password link on the Keycloak login page");
  }

  async confirmPasswordReset(): Promise<void> {
    throw new Error("Use the forgot-password link on the Keycloak login page");
  }
}
