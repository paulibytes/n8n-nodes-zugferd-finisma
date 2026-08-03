import type {
  IAuthenticateGeneric,
  ICredentialType,
  INodeProperties,
} from "n8n-workflow";

/**
 * API-Key eines finisma-Kontos. Prüfen ist mit jedem gültigen Key möglich,
 * Erzeugen setzt zusätzlich ein aktives Abo voraus — das entscheidet der
 * Server, nicht der Key.
 */
export class FinismaApi implements ICredentialType {
  name = "finismaApi";
  displayName = "finisma API";
  documentationUrl = "https://finisma.de/entwickler";

  properties: INodeProperties[] = [
    {
      displayName: "API-Key",
      name: "apiKey",
      type: "string",
      typeOptions: { password: true },
      default: "",
      required: true,
      description:
        'Im finisma-Konto unter "API-Zugang" erstellen. Beginnt mit "fnsm_" und wird nur einmal angezeigt.',
    },
    {
      displayName: "Basis-URL",
      name: "baseUrl",
      type: "string",
      default: "https://finisma.de",
      description:
        "Nur ändern, wenn eine eigene Instanz angesprochen werden soll. Ohne abschließenden Schrägstrich.",
    },
  ];

  authenticate: IAuthenticateGeneric = {
    type: "generic",
    properties: {
      headers: {
        Authorization: "=Bearer {{$credentials.apiKey}}",
      },
    },
  };
}
