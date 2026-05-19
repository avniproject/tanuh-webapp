export type IdpType = "cognito" | "keycloak" | "both" | "none";

export interface CognitoDetails {
  poolId: string;
  clientId: string;
  region: string;
}

export interface KeycloakDetails {
  authServerUrl: string;
  clientId: string;
  grantType: string;
  scope: string;
  realm: string;
}

export interface IdpDetails {
  idpType: IdpType;
  cognito?: CognitoDetails;
  keycloak?: KeycloakDetails;
}

export const AUTH_TOKEN_KEY = "authToken";
export const AUTH_USERNAME_KEY = "tanuh.authUsername";
