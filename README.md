# n8n-nodes-zugferd-finisma

This is an n8n community node for electronic invoices according to
**EN 16931** (ZUGFeRD, Factur-X and XRechnung) and for German payment and bank
statement files. It uses the public REST API of [finisma](https://finisma.de),
a German e-invoicing service, to:

- turn a PDF and structured invoice data into a ZUGFeRD invoice (PDF/A-3 with
  embedded CII XML), verify existing e-invoices and extract invoice data from
  a PDF,
- check business partners (VAT ID against VIES, Peppol participant),
- create SEPA and foreign payment files (pain.001), look up a BIC and check
  existing payment files,
- check bank statements (camt.052, camt.053, camt.054, camt.086) and read
  them into structured data.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/)
workflow automation platform.

- [Operations](#operations)
- [Installation](#installation)
- [Credentials](#credentials)
- [Usage](#usage)
- [Example workflow](#example-workflow)
- [Costs and limits](#costs-and-limits)
- [Errors](#errors)
- [Compatibility](#compatibility)
- [Resources](#resources)
- [Development](#development)
- [Changelog](#changelog)

## Operations

Select a **Resource**, then an **Operation**. Costs per operation are listed in
[Costs and limits](#costs-and-limits).

| Resource       | Operation                                 | What it does                                                                                                                                                            | API endpoint                       |
| -------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Invoice        | **Create**, output format **ZUGFeRD PDF** | Visual PDF + EN 16931 invoice data → ZUGFeRD PDF (PDF/A-3 with embedded CII XML)                                                                                        | `POST /api/v1/invoices`            |
| Invoice        | **Create**, output format **XML Only**    | EN 16931 invoice data → CII XML, no visual document. With `"profile": "xrechnung"` the result is an XRechnung 3.0                                                       | `POST /api/v1/invoices?format=xml` |
| Invoice        | **Verify**                                | Checks an existing e-invoice (PDF) against EN 16931, the ZUGFeRD/Factur-X rules and PDF/A-3 → report as JSON                                                            | `POST /api/v1/verify`              |
| Invoice        | **Extract Data**                          | Reads the EN 16931 invoice data from a PDF invoice → `invoice`, `issues`, `repairedPaths`, `source`                                                                     | `POST /api/v1/extractions`         |
| Partner        | **Check VAT ID**                          | Checks a VAT ID live against VIES → `status` valid, invalid or unavailable, plus the company name if the member state shares it                                         | `GET /api/v1/vat/check`            |
| Partner        | **Check Peppol Participant**              | Checks whether a partner can receive e-invoices over Peppol → `registered`, document types, name                                                                        | `GET /api/v1/peppol/check`         |
| Payment        | **Create SEPA File**                      | Payment run (JSON) → SEPA credit transfer file, pain.001.001.09, as binary                                                                                              | `POST /api/v1/payments/sepa`       |
| Payment        | **Create Foreign Payment File**           | Payment run (JSON) → foreign payment file in the German AXZ format, pain.001.001.09, as binary                                                                          | `POST /api/v1/payments/axz`        |
| Payment        | **Look Up BIC**                           | German bank code → BIC and bank name                                                                                                                                    | `GET /api/v1/payments/bank-lookup` |
| Payment        | **Validate File**                         | Checks an existing pain.001 file (SEPA or AXZ, versions .09 and .03): rules, schema, verdict                                                                            | `POST /api/v1/payments/validate`   |
| Bank Statement | **Validate**                              | Checks camt.052, camt.053, camt.054 (versions .02 and .08) and camt.086 (.01 to .05), also several files in a ZIP archive: rules, schema, verdict                       | `POST /api/v1/statements/validate` |
| Bank Statement | **Parse**                                 | Reads the same files into structured data: bookings with counterparty, IBAN, remittance information, end-to-end reference and transaction code, or bank fees (camt.086) | `POST /api/v1/statements/parse`    |

Workflows created with an earlier version of this node have no resource set.
They keep working unchanged: the resource defaults to **Invoice**, and the
operations **Create** and **Verify** keep their internal values and
parameters.

## Installation

### n8n Cloud and verified community nodes

Once n8n has verified this package, you can install it from the nodes panel:
open the nodes panel, search for **ZUGFeRD** and install the node. This works on
n8n Cloud and on self-hosted instances that allow verified community nodes.

### Self-hosted n8n

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/)
in the n8n community nodes documentation:

1. Go to **Settings > Community Nodes**.
2. Select **Install**.
3. Enter `n8n-nodes-zugferd-finisma` and confirm.

## Credentials

You need a finisma account. Registration is free and works with a login link,
without a password. The node supports two ways to authenticate. The node
parameter **Authentication** selects one.

### API key

1. Sign in at [finisma.de/konto](https://finisma.de/konto).
2. Open the section **API und Anwendungen** (API and apps) and create an API
   key. It starts with `fnsm_` and is shown only once.
3. In n8n, create a credential of type **Finisma API** and paste the key.

The credential test calls `GET /api/v1/me`, which returns the account and
subscription status and does not create anything.

### OAuth2

Use OAuth2 when a workflow should act for a finisma account that you do not
manage with your own API key.

1. In n8n, create a credential of type **Finisma OAuth2 API** and copy the
   **OAuth Redirect URL** shown at the top of the dialog.
2. In your finisma account, open **API und Anwendungen** and register an
   application in **Eigene Anwendungen (OAuth)** (your own applications). Enter a
   name and the redirect URL from step 1. It must match exactly. The client
   secret is shown only once.
3. Paste client ID and client secret into the n8n credential and click
   **Connect my account**.

n8n then holds the access token and renews it on its own. The grant type is
fixed to PKCE because finisma requires `code_challenge_method=S256` for every
client (OAuth 2.1). The requested scopes are `invoice:verify` and
`invoice:create`. The partner checks and the file checks for payment files
and bank statements use `invoice:verify`. Creating payment files and the BIC
lookup do not depend on a scope, only on the subscription of the account. Connected applications are listed in your finisma account,
and you can disconnect them there at any time. Details on the OAuth setup:
[finisma.de/entwickler/oauth](https://finisma.de/entwickler/oauth).

## Usage

### Invoice: Create

The source PDF must arrive as a **binary field** on the input item, for example
from an email trigger, a cloud storage node or an HTTP Request node. Set its
name in **Input Binary Field** (default `data`).

Put the invoice data as JSON into **Invoice Data (JSON)**. The authoritative
structure is the schema `Invoice` in the
[OpenAPI specification](https://finisma.de/api/v1/openapi.json). It is generated
from the validation schema and is therefore always up to date. The
[interactive API documentation](https://finisma.de/api-docs) shows the same
schema in a readable form. A minimal invoice:

```json
{
	"invoiceNumber": "2026-001",
	"issueDate": "2026-08-19",
	"dueDate": "2026-09-02",
	"seller": {
		"name": "Muster GmbH",
		"vatId": "DE123456789",
		"address": { "line1": "Hauptstr. 1", "postalCode": "20095", "city": "Hamburg" }
	},
	"buyer": {
		"name": "Kunde AG",
		"address": { "line1": "Marktplatz 5", "postalCode": "10115", "city": "Berlin" }
	},
	"lines": [
		{
			"name": "Consulting August",
			"quantity": 1,
			"unitPriceNet": 100,
			"vatRatePercent": 19,
			"lineNetAmount": 100
		}
	],
	"vatBreakdown": [{ "ratePercent": 19, "basisAmount": 100, "taxAmount": 19 }],
	"totalNet": 100,
	"totalVat": 19,
	"totalGross": 119
}
```

Everything else falls back to schema defaults (currency EUR, unit "piece", VAT
category S). Units of measure are normalized to UN/ECE Recommendation 20 codes.
Early payment discounts go into `payment.discountPercent` and
`payment.discountDays` and end up in the payment terms (BT-20) following the
KoSIT convention. Each line can carry article numbers: `sellerArticleId`
(BT-155), `buyerArticleId` (BT-156) and `globalArticleId` (BT-157, usually a
GTIN).

The result is stored as a binary field on the output item, named after
**Output Binary Field** (default `data`). The JSON part of the item contains
`filename`, `bytes` and `format` (`pdf` or `xml`). **Output File Name** is
optional. Without it, the node reuses the input file name.

### Output format

- **ZUGFeRD PDF** (default): the source PDF becomes the visual document, the
  CII XML is embedded, and the result is a PDF/A-3.
- **XML Only**: returns only the CII XML, without a visual document. The node
  hides **Input Binary Field** and sends only the invoice data. This is useful
  for public-sector portals and further processing in other systems, and it is
  much faster because the embedding step is skipped. With
  `"profile": "xrechnung"` in the invoice data, the result is an XRechnung 3.0
  for German public-sector buyers. This output needs an active subscription or
  credits, because the free quota marks invoices with a watermark and an XML
  file cannot carry one.

### Attachments

Supporting documents such as timesheets are embedded in the invoice. Pass them
as additional binary fields on the input item and list their names, separated
by commas, in **Attachment Binary Fields**, for example
`timesheet,serviceReport`. Allowed types are PDF, PNG, JPEG, CSV, XLSX, ODS and
XML, up to 10 MB each. The node takes MIME type and file name from the binary
field.

**Attachment Descriptions** takes one text per attachment, in the same order,
for example `Timesheet March 2026`. It fills BT-123, the description of the
supporting document. Without it, the recipient only sees the file name.

The field named in **Input Binary Field** is always skipped, so the invoice
never ends up attached to itself, even if the list was built from `$binary`.
Duplicate names are merged. A listed field that does not exist on the item
stops the node, because that is usually a typo.

Do not put attachments into the invoice data. The EN 16931 schema has no
`attachments` field, and such an entry is dropped silently.

### Invoice: Verify

Pass the e-invoice as a PDF in **Input Binary Field**. The node returns the
verification report of the API as JSON (structure, EN 16931 business rules,
PDF/A-3 conformance).

### Invoice: Extract Data

Pass a PDF invoice in **Input Binary Field**. The output contains `invoice`
(the EN 16931 fields, ready for **Create**), `issues` (open points such as
missing mandatory fields), `repairedPaths` and `source`. If the PDF already
carries an e-invoice, `source` is `xml` and the fields come from the embedded
XML. Otherwise a language model reads the PDF. Fields it could not read
safely contain placeholders (`KORRIGIEREN` for text, `1900-01-01` for dates,
`0` for amounts) and are listed in `repairedPaths`; replace them before
creating the invoice.

### Partner: Check VAT ID and Check Peppol Participant

**VAT ID** takes the ID with country prefix, for example `DE325821677`. The
output has `status` (`valid`, `invalid` or `unavailable`), `name`,
`countryCode` and `checkedAt`. `unavailable` means VIES or the member state did
not answer. It says nothing about the ID itself, so check again later.

**Participant ID** takes a full Peppol ID (`0088:4399901550926`), a bare GLN,
a German VAT ID or a Leitweg-ID. The output has `registered`,
`documentTypes`, `name` and `countryCode`. `registered: false` is a normal
result: the partner then receives the invoice as a ZUGFeRD PDF by email.

### Payment: Create SEPA File and Create Foreign Payment File

Put the payment run as JSON into **Payment Run (JSON)**. The structure is the
schema `PaymentRun` in the [OpenAPI specification](https://finisma.de/api/v1/openapi.json).
A minimal SEPA run:

```json
{
	"debtor": { "name": "Muster GmbH", "iban": "DE89370400440532013000" },
	"requestedExecutionDate": "2026-11-03",
	"payments": [
		{
			"creditorName": "Supplier AG",
			"creditorIban": "DE02120300000000202051",
			"amount": 100,
			"currency": "EUR",
			"remittanceInfo": "Invoice 2026-001"
		}
	]
}
```

The file goes into the binary field set in **Output Binary Field** (default
`data`), named like `sepa-inland-2026-11-03.xml` or
`axz-ausland-2026-11-03.xml`. The JSON part of the item contains `filename`,
`bytes`, `payments`, `controlSum`, `requestedExecutionDate`, `warnings` (non
blocking notes) and `verification` (`autoritativ` when the file passed the
final schema check at finisma).

Before creating the file, finisma checks the payment run (IBAN check digits,
amounts, execution date, character set). If a rule is broken, the node stops
with HTTP 422 and lists each finding with its path, for example
`payments.0.creditorIban`, and no file is created. The foreign payment file
additionally needs the address of the creditor (`creditorAddress` with at
least town and country) and of the debtor (`debtor.address`).

### Payment: Look Up BIC

Enter the German bank code in **Bank Code**. The output is
`{ "found": true, "bic": "DEUTDEBBXXX", "bankName": "Deutsche Bank", "dataDate": "2026-06-08" }`
or `{ "found": false }`. Only the country `DE` is supported. Other countries
return `{ "found": false, "reason": "unsupported_country" }`.

### Payment: Validate File

Pass a pain.001 file in **Input Binary Field**. **Profile** selects the rule
set: detected automatically (default), SEPA credit transfer or foreign
payment (AXZ). With **Simplify** on (default), the output is one item with
`verdict` (`valid`, `valid_with_warnings` or `invalid`), `profile`, `version`,
`payments`, `total`, `schemaValid`, `errors`, `warnings`, `billedVia` and
`freeRemaining`. Errors and warnings are texts such as
`PAY_IBAN_INVALID: …`. Schema findings start with `Schema` and name line and
column. `schemaValid` is `null` if the schema check was not available; the
verdict then rests on the rules only, and the call costs nothing. Turn **Simplify** off for the full API
response with paths and the complete summary.

### Bank Statement: Validate

Pass a camt file or a ZIP archive in **Input Binary Field**. A ZIP, for example
from an EBICS download, may contain up to 50 files; files that are not
supported camt files are listed in `skipped`. With **Simplify** on, the
output is one item with `verdict`, `files`, `schemaValid`, `errors`,
`warnings`, `skipped`, `billedVia` and `freeRemaining`. For camt.086 across
several files, missing pages of a delivery appear as errors or warnings.

### Bank Statement: Parse

With **Simplify** on (default), the node returns **one item per booking**
(camt.052, camt.053, camt.054; one item per transaction for batch bookings)
with `accountIban`, `bookingDate`, `amount`, `currency`, `creditDebit`
(`CRDT` credit, `DBIT` debit; the amount has no sign), `counterpartyName`,
`counterpartyIban`, `remittanceInfo`, `endToEndId` and
`bankTransactionCode` (the German GVC if present, otherwise
domain/family/subfamily). For camt.086 the node returns one item per service
with `statementId`, `accountIban`, `serviceId`, `description`, `volume`,
`unitPrice`, `charge`, `currency`, `tax` and `paymentMethod`.

With **Simplify** off, the node returns one item with the complete API
response: statements with account, balances and entries (value date,
reversal flag, all references, structured remittance keys), and for camt.086
the totals per currency.

## Example workflow

Downloads a PDF, turns it into a ZUGFeRD invoice and verifies the result.
Copy the JSON and paste it into the n8n editor. Replace the URL with a PDF of
your own and select your finisma credential in both finisma nodes.

```json
{
	"name": "Create and verify a ZUGFeRD invoice",
	"nodes": [
		{
			"parameters": {},
			"name": "When clicking 'Execute workflow'",
			"type": "n8n-nodes-base.manualTrigger",
			"typeVersion": 1,
			"position": [0, 0]
		},
		{
			"parameters": {
				"url": "https://example.com/invoice-2026-001.pdf",
				"options": {
					"response": { "response": { "responseFormat": "file" } }
				}
			},
			"name": "Download PDF",
			"type": "n8n-nodes-base.httpRequest",
			"typeVersion": 4.2,
			"position": [220, 0]
		},
		{
			"parameters": {
				"operation": "create",
				"invoice": "{\n  \"invoiceNumber\": \"2026-001\",\n  \"issueDate\": \"2026-08-19\",\n  \"dueDate\": \"2026-09-02\",\n  \"seller\": { \"name\": \"Muster GmbH\", \"vatId\": \"DE123456789\", \"address\": { \"line1\": \"Hauptstr. 1\", \"postalCode\": \"20095\", \"city\": \"Hamburg\" } },\n  \"buyer\": { \"name\": \"Kunde AG\", \"address\": { \"line1\": \"Marktplatz 5\", \"postalCode\": \"10115\", \"city\": \"Berlin\" } },\n  \"lines\": [ { \"name\": \"Consulting August\", \"quantity\": 1, \"unitPriceNet\": 100, \"vatRatePercent\": 19, \"lineNetAmount\": 100 } ],\n  \"vatBreakdown\": [ { \"ratePercent\": 19, \"basisAmount\": 100, \"taxAmount\": 19 } ],\n  \"totalNet\": 100,\n  \"totalVat\": 19,\n  \"totalGross\": 119\n}"
			},
			"name": "Create ZUGFeRD Invoice",
			"type": "n8n-nodes-zugferd-finisma.zugferdFinisma",
			"typeVersion": 1,
			"position": [440, 0]
		},
		{
			"parameters": {
				"operation": "verify"
			},
			"name": "Verify Invoice",
			"type": "n8n-nodes-zugferd-finisma.zugferdFinisma",
			"typeVersion": 1,
			"position": [660, 0]
		}
	],
	"connections": {
		"When clicking 'Execute workflow'": {
			"main": [[{ "node": "Download PDF", "type": "main", "index": 0 }]]
		},
		"Download PDF": {
			"main": [[{ "node": "Create ZUGFeRD Invoice", "type": "main", "index": 0 }]]
		},
		"Create ZUGFeRD Invoice": {
			"main": [[{ "node": "Verify Invoice", "type": "main", "index": 0 }]]
		}
	}
}
```

In a real workflow, the invoice data usually comes from a previous node. Use an
expression such as `{{ JSON.stringify($json.invoice) }}` in
**Invoice Data (JSON)**.

## Costs and limits

As stated in the [finisma REST API reference](https://finisma.de/entwickler/rest)
(October 2026). Current prices: [finisma.de/preise](https://finisma.de/preise).

- **Invoice: Verify** is free of charge. It still needs a credential, which you
  get with a free account.
- **Invoice: Create, ZUGFeRD PDF** runs with an active subscription, with credits
  (1 credit per invoice, no watermark, no daily limit) or from the free daily
  quota. Invoices from the free quota carry the finisma verification seal as a
  watermark, and the quota resets at midnight.
- **Invoice: Create, XML Only** needs an active subscription or credits (1 credit
  per call). Without either, the API answers `403 subscription_required`.
- **Invoice: Extract Data** needs an active subscription or costs 1 credit per
  call (a language model reads the PDF).
- **Partner: Check VAT ID** and **Check Peppol Participant** are free of charge
  and need a credential.
- **Payment: Create SEPA File** and **Look Up BIC** need the finisma payments
  subscription (EUR 29 per month plus VAT). **Create Foreign Payment File**
  also needs the foreign payments add-on (EUR 19 per month plus VAT, EUR 48
  together).
- **Payment: Validate File** and **Bank Statement: Validate**: 5 checks per day
  and account free of charge each, starting again at midnight (Europe/Berlin).
  Beyond that, 1 credit buys a block of 10 checks, shared by both operations.
  Open checks do not expire.
- **Bank Statement: Parse**: 5 calls per month and account free of charge,
  starting again on the first of the month (Europe/Berlin). Beyond that, each
  call costs 1 credit.
- The payments subscription removes these limits. Without subscription and
  credits, the API answers `402 payment_required`. Each response reports how
  it was paid (`billedVia` with Simplify on, `billing` otherwise):
  `free_quota`, `subscription`, `check_block` or `credit`, plus the free calls
  left in the current period (`freeRemaining`).
- Credits are topped up in the finisma account (EUR 10 for 25 credits).
- Every active subscription unlocks the API (from EUR 8 per month plus VAT). The
  subscription has a fair-use limit of 100 invoices per month, plus 1,000 per
  additional volume package. `GET /api/v1/me` reports the current usage.

Technical limits, as reported by the API itself at
[`GET /api/v1/formats`](https://finisma.de/api/v1/formats):

| Limit                                                             | Value                                       |
| ----------------------------------------------------------------- | ------------------------------------------- |
| Requests per minute, verify                                       | 30                                          |
| Requests per minute, create                                       | 20                                          |
| Requests per minute, extract                                      | 10                                          |
| Requests per minute, partner checks, file checks, bank statements | 30                                          |
| Source PDF                                                        | 25 MB                                       |
| Payment file, bank statement or ZIP archive                       | 10 MB (ZIP: up to 50 files, 30 MB unpacked) |
| Invoice data (JSON)                                               | 1 MB                                        |
| Each attachment                                                   | 10 MB                                       |

## Errors

The API answers with JSON `{ "error", "code", "details" }` and a matching HTTP
status. The node shows the status, the code and the message, plus the field
paths from `details` and a hint on what to do next.

| Status | Code                           | Meaning                                                                                                                                                                      |
| ------ | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | `invalid_input`                | File, invoice data or payment run is invalid, or the file is not a supported format. `details` names the field paths.                                                        |
| 401    | `auth_required`, `invalid_key` | Credential missing, invalid, expired or revoked                                                                                                                              |
| 402    | `payment_required`             | File checks and bank statements: free quota used up, no payments subscription and no credits. `Retry-After` points to midnight (checks) or the start of the month (parsing). |
| 403    | `subscription_required`        | Neither subscription nor credits (XML only, extract, or when the free quota does not apply), or the payments subscription is missing                                         |
| 403    | `insufficient_scope`           | OAuth2 token without the required scope                                                                                                                                      |
| 429    | `free_quota_exhausted`         | Free daily quota used up. `Retry-After` points to midnight.                                                                                                                  |
| 413    | `payload_too_large`            | File or ZIP archive larger than 10 MB                                                                                                                                        |
| 422    | `invalid_input`                | Payment files: the payment run breaks a rule. `details` lists each finding with its path, and no file is created.                                                            |
| 429    | `rate_limited`                 | Too many requests. `Retry-After` gives the wait time.                                                                                                                        |
| 502    | `upstream_error`               | A downstream service of finisma returned an error. When creating payment files, also: the created file did not pass the final schema check, and no file was delivered.       |
| 503    |                                | Peppol check: the Peppol directory (SML) did not answer                                                                                                                      |

The message texts come from the finisma API, which answers in German. Status
and code are language-independent.

With **Settings > On Error > Continue** (Continue On Fail), the message ends up
in the `error` field of the item instead of stopping the workflow.

## Compatibility

Tested with n8n 2.32.7 (self-hosted, Docker image `n8nio/n8n`).

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [finisma REST API reference](https://finisma.de/entwickler/rest) (German)
- [Interactive API documentation](https://finisma.de/api-docs) (German)
- [OpenAPI specification](https://finisma.de/api/v1/openapi.json)
- [OAuth setup at finisma](https://finisma.de/entwickler/oauth) (German)

Questions about the API, invoice data or validation:
[erechnung@paulibytes.de](mailto:erechnung@paulibytes.de). Bugs and feature
requests for this node:
[GitHub issues](https://github.com/paulibytes/n8n-nodes-zugferd-finisma/issues).

## Development

The package follows the conventions of the
[`@n8n/node-cli`](https://www.npmjs.com/package/@n8n/node-cli) (`n8n-node`).

```bash
npm install        # install dev dependencies (CI uses npm ci)
npm run dev        # start a local n8n with this node at http://localhost:5678
npm run lint       # n8n community node linter (must pass for verification)
npm run lint:fix   # fix what can be fixed automatically
npm run build      # compile to dist/
```

Releases are published to npm only by the GitHub Actions workflow
`.github/workflows/publish.yml`, with npm provenance. The workflow runs when a
version tag such as `0.3.0` is pushed.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE)
