# Changelog

All notable changes to this package are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the package uses [Semantic Versioning](https://semver.org/).

## [0.3.0] - unreleased

Prepared for verification by n8n, so the node can be installed on n8n Cloud.
Includes the changes of 0.2.0, which was never published to npm.

### Added

- Resources and operations following the n8n conventions: **Invoice** (Create,
  Verify, Extract Data), **Partner** (Check VAT ID, Check Peppol Participant),
  **Payment** (Create SEPA File, Create Foreign Payment File, Look Up BIC,
  Validate File) and **Bank Statement** (Validate, Parse). Existing workflows
  without a resource keep running as Invoice Create and Verify.
- Invoice > Extract Data: reads the EN 16931 invoice data from a PDF
  (`POST /api/v1/extractions`).
- Partner checks: VAT ID against VIES and Peppol participant lookup.
- Payment files: SEPA and foreign (AXZ) pain.001 files from a payment run as
  binary output, BIC lookup for German bank codes, and checking existing
  pain.001 files with rules and schema.
- Bank statements: check camt.052, camt.053, camt.054 and camt.086 (also as a
  ZIP archive) and read them into structured data, with Simplify (one item
  per booking or per bank fee service).
- Output format "XML Only" for the operation "Create Invoice": returns the CII
  XML without a visual document and without a source PDF. Needs a finisma
  subscription or credits.
- Credential test for the API key credential (`GET /api/v1/me`).
- Light and dark node icon.
- Publishing through GitHub Actions with npm provenance
  (`.github/workflows/publish.yml`), plus a CI workflow for lint and build.

### Fixed

- 'Input Binary Field' was hidden for Create with the output format ZUGFeRD
  PDF, so the source PDF could only come from the field `data`. It is now
  shown and used.

### Changed

- All UI text, error messages and the README are now in English.
- Operation labels are now "Create" and "Verify" under the resource Invoice;
  their internal values are unchanged.
- Node display name is now "ZUGFeRD E-Invoice (finisma)"; credential display
  names are "Finisma API" and "Finisma OAuth2 API". Internal names are
  unchanged, so existing workflows and credentials keep working.
- Node file and class renamed to `ZugferdFinisma` (n8n naming convention).
- Error messages name the affected item and parameter and suggest a fix.
- Build, lint and release run through the `@n8n/node-cli` (`n8n-node`)
  toolchain. The package manager is npm.
- Node is marked as usable as an AI agent tool.

### Removed

- Unused entry point `index.js` and the custom asset copy script.
- The "Base URL" field of the Finisma API credential. Requests always go to
  `https://finisma.de`; a value stored in an existing credential is ignored.

## [0.1.0] - 2026-08-03

### Added

- First release: operations "Create Invoice" (ZUGFeRD PDF from a PDF and
  EN 16931 invoice data, with embedded attachments) and "Verify Invoice".
- Authentication with an API key or OAuth2 (PKCE).

[0.3.0]: https://github.com/paulibytes/n8n-nodes-zugferd-finisma/compare/0f4a86f...HEAD
[0.1.0]: https://github.com/paulibytes/n8n-nodes-zugferd-finisma/commit/0f4a86f
