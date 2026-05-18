import type { IdpDetails } from "./IdpDetails";
import type { IdpClient } from "./IdpClient";
import { CognitoClient } from "./CognitoClient";
import { KeycloakClient } from "./KeycloakClient";

/**
 * Build the appropriate IdpClient for the given /idp-details response.
 * The "both" case picks Keycloak by default if its config is present, else Cognito.
 * Adjust if the Tanuh org needs a different default.
 */
export function createIdpClient(details: IdpDetails): IdpClient {
  switch (details.idpType) {
    case "cognito":
      if (!details.cognito) throw new Error("idpType=cognito but cognito config missing");
      return new CognitoClient(details.cognito);
    case "keycloak":
      if (!details.keycloak) throw new Error("idpType=keycloak but keycloak config missing");
      return new KeycloakClient(details.keycloak);
    case "both":
      if (details.keycloak) return new KeycloakClient(details.keycloak);
      if (details.cognito) return new CognitoClient(details.cognito);
      throw new Error("idpType=both but neither cognito nor keycloak config present");
    case "none":
      throw new Error("idpType=none — this app requires authentication");
    default:
      throw new Error(`Unsupported idpType: ${(details as IdpDetails).idpType}`);
  }
}
