import type { ICredentialType, INodeProperties } from "n8n-workflow";

/**
 * OAuth 2.1 statt API-Key: Der Nutzer klickt in n8n auf "Connect my account",
 * meldet sich bei finisma an und bestätigt den Zugriff. n8n hält danach ein
 * Access-Token und erneuert es selbst über den Refresh-Token.
 *
 * Grant Type ist zwingend PKCE — finisma verlangt code_challenge_method=S256
 * für jeden Client, auch für vertrauliche (OAuth 2.1). Client-ID und -Secret
 * bekommt der Nutzer über die Client-Registrierung; wie das geht, steht unter
 * https://finisma.de/entwickler.
 */
export class FinismaOAuth2Api implements ICredentialType {
  name = "finismaOAuth2Api";
  extends = ["oAuth2Api"];
  displayName = "finisma OAuth2 API";
  documentationUrl = "https://finisma.de/entwickler";

  properties: INodeProperties[] = [
    {
      displayName: "Grant Type",
      name: "grantType",
      type: "hidden",
      default: "pkce",
    },
    {
      displayName: "Authorization URL",
      name: "authUrl",
      type: "hidden",
      default: "https://finisma.de/api/oauth/authorize",
    },
    {
      displayName: "Access Token URL",
      name: "accessTokenUrl",
      type: "hidden",
      default: "https://finisma.de/api/oauth/token",
    },
    {
      displayName: "Scope",
      name: "scope",
      type: "hidden",
      default: "invoice:verify invoice:create",
    },
    {
      displayName: "Auth URI Query Parameters",
      name: "authQueryParameters",
      type: "hidden",
      default: "",
    },
    {
      displayName: "Authentication",
      name: "authentication",
      type: "hidden",
      default: "body",
    },
  ];
}
