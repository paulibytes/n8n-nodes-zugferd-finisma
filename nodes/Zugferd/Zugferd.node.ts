import type {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  IHttpRequestOptions,
  IDataObject,
  INode,
} from "n8n-workflow";
import { NodeOperationError, NodeConnectionTypes } from "n8n-workflow";

const API_KEY_CREDENTIALS = "finismaApi";
const OAUTH_CREDENTIALS = "finismaOAuth2Api";

/**
 * Macht eine Fehlerantwort der API lesbar.
 *
 * Beim Erzeugen fordern wir die Antwort als Rohbytes an, weil der Erfolgsfall
 * eine PDF ist. Damit kommt auch ein Fehler als Byte-Array herein, und n8n
 * zeigte dafür eine Zahlenwüste statt der Meldung. Genau dort steht aber das
 * Entscheidende: welches Feld fehlt oder nicht zum Schema passt.
 */
function apiError(
  node: INode,
  statusCode: number,
  raw: unknown,
  itemIndex: number
): NodeOperationError {
  let body: unknown = raw;
  if (Buffer.isBuffer(raw)) {
    body = raw.toString("utf8");
  } else if (raw instanceof ArrayBuffer) {
    body = Buffer.from(raw).toString("utf8");
  }
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      /* kein JSON — der Text bleibt, wie er ist */
    }
  }

  const obj = (typeof body === "object" && body !== null ? body : {}) as {
    error?: unknown;
    code?: unknown;
    details?: unknown;
  };
  const message =
    typeof obj.error === "string"
      ? obj.error
      : typeof body === "string" && body.length > 0
        ? body.slice(0, 300)
        : `finisma antwortete mit HTTP ${statusCode}.`;
  const code = typeof obj.code === "string" ? ` [${obj.code}]` : "";

  // details trägt bei Schema-Fehlern die Feldpfade. Gekürzt, damit die Meldung
  // im Node lesbar bleibt.
  let description: string | undefined;
  if (Array.isArray(obj.details)) {
    const parts = obj.details
      .map((d) => {
        const e = d as { path?: unknown; message?: unknown };
        if (typeof e?.path === "string" && typeof e?.message === "string") {
          return `${e.path}: ${e.message}`;
        }
        return typeof d === "string" ? d : JSON.stringify(d);
      })
      .filter(Boolean);
    if (parts.length > 0) {
      const shown = parts.slice(0, 12).join("; ");
      description =
        parts.length > 12 ? `${shown} … (${parts.length} Beanstandungen)` : shown;
    }
  }

  return new NodeOperationError(node, `finisma (HTTP ${statusCode})${code}: ${message}`, {
    itemIndex,
    description,
  });
}

/**
 * ZUGFeRD-/E-Rechnungs-Node für n8n. Zwei Operationen, deckungsgleich mit der
 * öffentlichen REST-API (https://finisma.de/entwickler):
 *
 *  - create: visuelle PDF + EN-16931-Daten  ->  fertige ZUGFeRD-PDF (PDF/A-3)
 *  - verify: E-Rechnung prüfen              ->  strukturierter Prüfbericht
 *
 * Beide Endpunkte sprechen multipart/form-data; das PDF kommt als Binärfeld
 * aus dem vorherigen Node und geht bei create als Binärfeld wieder hinaus.
 */
export class Zugferd implements INodeType {
  description: INodeTypeDescription = {
    displayName: "ZUGFeRD / E-Rechnung (finisma)",
    name: "zugferdFinisma",
    icon: "file:finisma.svg",
    group: ["transform"],
    version: 1,
    subtitle: '={{$parameter["operation"]}}',
    description:
      "ZUGFeRD-Rechnungen nach EN 16931 erzeugen und vorhandene E-Rechnungen prüfen",
    defaults: { name: "ZUGFeRD" },
    // NodeConnectionType ist in aktuellen n8n-Versionen nur noch der Typ;
    // die Werte liefert die Konstante NodeConnectionTypes.
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    credentials: [
      {
        name: API_KEY_CREDENTIALS,
        required: true,
        displayOptions: { show: { authentication: ["apiKey"] } },
      },
      {
        name: OAUTH_CREDENTIALS,
        required: true,
        displayOptions: { show: { authentication: ["oAuth2"] } },
      },
    ],
    properties: [
      {
        displayName: "Authentifizierung",
        name: "authentication",
        type: "options",
        noDataExpression: true,
        options: [
          {
            name: "API-Key",
            value: "apiKey",
            description: "Key aus dem finisma-Konto eintragen",
          },
          {
            name: "OAuth2",
            value: "oAuth2",
            description:
              "Konto einmal verbinden; n8n erneuert das Token selbstständig",
          },
        ],
        default: "apiKey",
      },
      {
        displayName: "Operation",
        name: "operation",
        type: "options",
        noDataExpression: true,
        options: [
          {
            name: "Rechnung erzeugen",
            value: "create",
            description:
              "PDF und Rechnungsdaten zur ZUGFeRD-Rechnung verbinden (Abo nötig)",
            action: "ZUGFeRD-Rechnung erzeugen",
          },
          {
            name: "Rechnung prüfen",
            value: "verify",
            description:
              "Vorhandene E-Rechnung gegen EN 16931 und PDF/A-3 prüfen (kostenlos)",
            action: "E-Rechnung prüfen",
          },
        ],
        default: "create",
      },
      {
        displayName: "PDF-Feld (Binary)",
        name: "binaryPropertyName",
        type: "string",
        default: "data",
        required: true,
        description:
          "Name des Binärfelds im Eingangs-Item, das die PDF enthält",
      },
      {
        displayName: "Rechnungsdaten (JSON)",
        name: "invoice",
        type: "json",
        default: "{}",
        required: true,
        displayOptions: { show: { operation: ["create"] } },
        description:
          "Rechnungsdaten nach EN 16931. Struktur siehe Schema 'Invoice' unter https://finisma.de/api/v1/openapi.json",
      },
      {
        displayName: "Anhang-Felder (Binary)",
        name: "attachmentFields",
        type: "string",
        default: "",
        displayOptions: { show: { operation: ["create"] } },
        placeholder: "stundennachweis,leistungsschein",
        description:
          "Namen weiterer Binärfelder des Items, die als Anhang in die Rechnung eingebettet werden, durch Komma getrennt. Leer lassen, wenn es keine Anhänge gibt. Das PDF-Feld wird dabei immer übersprungen, die Rechnung landet also nie als Anhang in sich selbst. Erlaubt sind PDF, PNG, JPEG, CSV, XLSX, ODS und XML, je bis 10 MB.",
      },
      {
        displayName: "Anhang-Beschreibungen",
        name: "attachmentDescriptions",
        type: "string",
        default: "",
        displayOptions: { show: { operation: ["create"] } },
        placeholder: "Stundennachweis März 2026,Leistungsschein",
        description:
          "Beschreibungen der Anhänge (BT-123), durch Komma getrennt und in derselben Reihenfolge wie die Anhang-Felder. Ohne Angabe steht beim Empfänger nur der Dateiname. Kommas innerhalb einer Beschreibung sind nicht möglich.",
      },
      {
        displayName: "Dateiname der Ausgabe",
        name: "filename",
        type: "string",
        default: "",
        displayOptions: { show: { operation: ["create"] } },
        description:
          "Optional. Leer lassen, um den Namen der Eingangsdatei zu übernehmen.",
      },
      {
        displayName: "Ausgabe-Binärfeld",
        name: "outputBinaryPropertyName",
        type: "string",
        default: "data",
        displayOptions: { show: { operation: ["create"] } },
        description:
          "Unter diesem Namen wird die erzeugte ZUGFeRD-PDF im Item abgelegt",
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const out: INodeExecutionData[] = [];

    const authentication = this.getNodeParameter("authentication", 0) as string;
    const credentialName =
      authentication === "oAuth2" ? OAUTH_CREDENTIALS : API_KEY_CREDENTIALS;

    // Die eigene Basis-URL gibt es nur beim API-Key; die OAuth-Endpunkte sind
    // in der Credential fest hinterlegt und zeigen auf finisma.de.
    const credentials = await this.getCredentials(credentialName);
    const baseUrl = String(credentials.baseUrl ?? "https://finisma.de").replace(
      /\/+$/,
      ""
    );

    for (let i = 0; i < items.length; i++) {
      try {
        const operation = this.getNodeParameter("operation", i) as string;
        const binaryPropertyName = this.getNodeParameter(
          "binaryPropertyName",
          i
        ) as string;

        const binary = items[i].binary?.[binaryPropertyName];
        if (!binary) {
          throw new NodeOperationError(
            this.getNode(),
            `Kein Binärfeld "${binaryPropertyName}" im Item ${i}. Die PDF muss als Binärdatei anliegen.`,
            { itemIndex: i }
          );
        }
        const pdfBuffer = await this.helpers.getBinaryDataBuffer(
          i,
          binaryPropertyName
        );
        const sourceFilename = binary.fileName ?? "rechnung.pdf";

        const form = new FormData();
        form.append(
          "pdf",
          new Blob([new Uint8Array(pdfBuffer)], { type: "application/pdf" }),
          sourceFilename
        );

        if (operation === "verify") {
          const options: IHttpRequestOptions = {
            method: "POST",
            url: `${baseUrl}/api/v1/verify`,
            body: form,
            json: true,
            returnFullResponse: true,
            // Status selbst auswerten, damit die Meldung der API im Fehlerfall
            // erhalten bleibt statt in einer generischen n8n-Exception zu enden.
            ignoreHttpStatusErrors: true,
          };
          const res = (await this.helpers.httpRequestWithAuthentication.call(
            this,
            credentialName,
            options
          )) as { statusCode: number; body: IDataObject };
          if (res.statusCode >= 400) {
            throw apiError(this.getNode(), res.statusCode, res.body, i);
          }
          out.push({ json: res.body, pairedItem: { item: i } });
          continue;
        }

        // ── create ────────────────────────────────────────────────────────
        const invoiceParam = this.getNodeParameter("invoice", i);
        // Der json-Parametertyp liefert je nach Eingabe String oder Objekt.
        let invoiceJson: string;
        if (typeof invoiceParam === "string") {
          try {
            JSON.parse(invoiceParam);
          } catch {
            throw new NodeOperationError(
              this.getNode(),
              "Rechnungsdaten sind kein gültiges JSON.",
              { itemIndex: i }
            );
          }
          invoiceJson = invoiceParam;
        } else {
          invoiceJson = JSON.stringify(invoiceParam);
        }
        form.append(
          "invoice",
          new Blob([invoiceJson], { type: "application/json" })
        );

        // Anhänge gehen als weitere Datei-Parts mit demselben Feldnamen. Sie
        // gehören ausdrücklich NICHT in die Rechnungsdaten: das EN-16931-Schema
        // kennt kein attachments-Feld, ein Eintrag dort würde beim Prüfen
        // stillschweigend verworfen.
        const attachmentFields = [
          ...new Set(
            (this.getNodeParameter("attachmentFields", i) as string)
              .split(",")
              .map((f) => f.trim())
              .filter(Boolean)
          ),
        ]
          // Das PDF-Feld ist die Rechnung selbst und wird niemals angehängt,
          // sonst steckte die Rechnung als Anhang in sich. Bewusst überspringen
          // statt abzubrechen: eine aus $binary erzeugte Feldliste enthält den
          // Namen zwangsläufig mit, und das soll einfach funktionieren.
          .filter((f) => f !== binaryPropertyName);
        const attachmentDescriptions = (
          this.getNodeParameter("attachmentDescriptions", i) as string
        )
          .split(",")
          .map((d) => d.trim());
        for (const [n, field] of attachmentFields.entries()) {
          const meta = items[i].binary?.[field];
          if (!meta) {
            throw new NodeOperationError(
              this.getNode(),
              `Kein Binärfeld "${field}" im Item ${i}. Anhang-Felder müssen als Binärdaten anliegen.`,
              { itemIndex: i }
            );
          }
          const buf = await this.helpers.getBinaryDataBuffer(i, field);
          form.append(
            "attachments",
            new Blob([new Uint8Array(buf)], {
              type: meta.mimeType || "application/octet-stream",
            }),
            meta.fileName ?? field
          );
          // Positionsgleich zum Datei-Part; ein leerer Eintrag lässt der API
          // die Rückfallebene Dateiname.
          form.append("attachmentDescriptions", attachmentDescriptions[n] ?? "");
        }

        const filename =
          (this.getNodeParameter("filename", i) as string) ||
          sourceFilename.replace(/\.pdf$/i, "") + "-zugferd.pdf";
        form.append("filename", filename);

        const options: IHttpRequestOptions = {
          method: "POST",
          url: `${baseUrl}/api/v1/invoices`,
          body: form,
          // Antwort ist die fertige PDF, kein JSON. Der Accept-Header muss
          // ausdrücklich gesetzt werden: n8n schickt sonst die axios-Vorgabe
          // "application/json, text/plain, */*", und die Aushandlung der API
          // liefert daraufhin die Base64-Hülle statt der Bytes.
          headers: { Accept: "application/pdf" },
          encoding: "arraybuffer",
          json: false,
          returnFullResponse: true,
          // Ein Fehler kommt damit ebenfalls als Rohbytes; apiError macht die
          // Meldung samt Feldpfaden daraus wieder lesbar.
          ignoreHttpStatusErrors: true,
        };
        const response = (await this.helpers.httpRequestWithAuthentication.call(
          this,
          credentialName,
          options
        )) as { statusCode: number; body: Buffer | ArrayBuffer; headers: IDataObject };
        if (response.statusCode >= 400) {
          throw apiError(this.getNode(), response.statusCode, response.body, i);
        }

        const pdf = Buffer.isBuffer(response.body)
          ? response.body
          : Buffer.from(response.body as ArrayBuffer);
        // Sicherheitsnetz: Kommt etwas anderes als eine PDF zurück, darf das
        // nicht als Binärdatei durchgehen. Genau so entstand eine .pdf, die in
        // Wahrheit JSON enthielt, und das fiel erst beim Öffnen auf.
        if (pdf.subarray(0, 5).toString("latin1") !== "%PDF-") {
          throw new NodeOperationError(
            this.getNode(),
            "Antwort ist keine PDF-Datei. Erwartet wurden die Bytes der ZUGFeRD-Rechnung.",
            {
              itemIndex: i,
              description: pdf.subarray(0, 200).toString("utf8"),
            }
          );
        }
        const outField = this.getNodeParameter(
          "outputBinaryPropertyName",
          i
        ) as string;

        out.push({
          json: { filename, bytes: pdf.length },
          binary: {
            [outField]: await this.helpers.prepareBinaryData(
              pdf,
              filename,
              "application/pdf"
            ),
          },
          pairedItem: { item: i },
        });
      } catch (error) {
        if (this.continueOnFail()) {
          out.push({
            json: { error: (error as Error).message },
            pairedItem: { item: i },
          });
          continue;
        }
        throw error;
      }
    }

    return [out];
  }
}
