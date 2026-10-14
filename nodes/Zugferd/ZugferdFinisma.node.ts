import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestOptions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import {
	bankStatementProperties,
	invoiceProperties,
	operationProperties,
	partnerProperties,
	paymentProperties,
	resourceProperty,
} from './descriptions';
import {
	simplifyPaymentValidation,
	simplifyStatementParse,
	simplifyStatementValidation,
} from './simplify';
import { apiError, jsonParameter, type CallContext } from './transport';

interface ApiResponse<T> {
	statusCode: number;
	body: T;
	headers: IDataObject;
}

/**
 * finisma node for n8n. Every operation maps one to one to an endpoint of the
 * public finisma REST API (https://finisma.de/entwickler/rest):
 *
 *  Invoice        create   POST /api/v1/invoices (PDF or ?format=xml)
 *                 verify   POST /api/v1/verify
 *                 extract  POST /api/v1/extractions
 *  Partner        checkVatId   GET /api/v1/vat/check
 *                 checkPeppol  GET /api/v1/peppol/check
 *  Payment        createSepaFile     POST /api/v1/payments/sepa
 *                 createForeignFile  POST /api/v1/payments/axz
 *                 lookUpBic          GET  /api/v1/payments/bank-lookup
 *                 validateFile       POST /api/v1/payments/validate
 *  Bank Statement validate  POST /api/v1/statements/validate
 *                 parse     POST /api/v1/statements/parse
 *
 * Workflows from versions before 0.3.0 have no 'resource' parameter. Its
 * default 'invoice' and the unchanged operation values keep them running.
 */
export class ZugferdFinisma implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'ZUGFeRD E-Invoice (finisma)',
		name: 'zugferdFinisma',
		icon: { light: 'file:finisma.svg', dark: 'file:finisma.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description:
			'Create and verify e-invoices (ZUGFeRD, XRechnung), check business partners, create and check payment files and read bank statements',
		defaults: { name: 'ZUGFeRD' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'finismaApi',
				required: true,
				displayOptions: { show: { authentication: ['apiKey'] } },
			},
			{
				name: 'finismaOAuth2Api',
				required: true,
				displayOptions: { show: { authentication: ['oAuth2'] } },
			},
		],
		properties: [
			{
				displayName: 'Authentication',
				name: 'authentication',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'API Key',
						value: 'apiKey',
						description: 'Use an API key from your finisma account',
					},
					{
						name: 'OAuth2',
						value: 'oAuth2',
						description: 'Connect your finisma account once, n8n refreshes the token automatically',
					},
				],
				default: 'apiKey',
			},
			resourceProperty,
			...operationProperties,
			...invoiceProperties,
			...partnerProperties,
			...paymentProperties,
			...bankStatementProperties,
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const out: INodeExecutionData[] = [];

		const authentication = this.getNodeParameter('authentication', 0) as string;
		const credentialName = authentication === 'oAuth2' ? 'finismaOAuth2Api' : 'finismaApi';

		// Both credentials point to finisma.de; the API has no other instance.
		const baseUrl = 'https://finisma.de';

		/**
		 * Calls the API with the selected credential. The status is evaluated
		 * here, so the API message survives instead of ending up in a generic
		 * n8n exception.
		 */
		const call = async <T>(
			options: IHttpRequestOptions,
			itemIndex: number,
			context: CallContext,
		): Promise<ApiResponse<T>> => {
			const res = (await this.helpers.httpRequestWithAuthentication.call(this, credentialName, {
				...options,
				returnFullResponse: true,
				ignoreHttpStatusErrors: true,
			})) as ApiResponse<T>;
			if (res.statusCode >= 400) {
				throw apiError(this.getNode(), res.statusCode, res.body, itemIndex, context);
			}
			return res;
		};

		/** Reads a binary field of the input item, with a readable message if it is missing. */
		const readBinary = async (itemIndex: number, field: string, what: string) => {
			const meta = items[itemIndex].binary?.[field];
			if (!meta) {
				throw new NodeOperationError(
					this.getNode(),
					`The input item has no binary field "${field}" [item ${itemIndex}]`,
					{
						itemIndex,
						description: `The ${what} must arrive as binary data. Check that the previous node outputs a file and that 'Input Binary Field' matches the name of its binary field.`,
					},
				);
			}
			const buffer = await this.helpers.getBinaryDataBuffer(itemIndex, field);
			return { buffer, fileName: meta.fileName, mimeType: meta.mimeType };
		};

		/** Multipart request with one file part, used by the file check operations. */
		const postFile = async (
			itemIndex: number,
			path: string,
			what: string,
			extra: Record<string, string> = {},
		) => {
			const field = this.getNodeParameter('binaryPropertyName', itemIndex) as string;
			const file = await readBinary(itemIndex, field, what);
			const form = new FormData();
			form.append(
				'file',
				new Blob([new Uint8Array(file.buffer)], {
					type: file.mimeType || 'application/octet-stream',
				}),
				file.fileName ?? 'file.xml',
			);
			for (const [k, v] of Object.entries(extra)) form.append(k, v);
			const res = await call<{ summary: string; result: IDataObject }>(
				{ method: 'POST', url: `${baseUrl}${path}`, body: form, json: true },
				itemIndex,
				'fileCheck',
			);
			return res.body;
		};

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i, 'invoice') as string;
				const operation = this.getNodeParameter('operation', i) as string;
				const paired = { item: i };

				// ── Partner ──────────────────────────────────────────────────────
				if (resource === 'partner') {
					const isVat = operation === 'checkVatId';
					const res = await call<{ result: IDataObject }>(
						{
							method: 'GET',
							url: `${baseUrl}/api/v1/${isVat ? 'vat/check' : 'peppol/check'}`,
							qs: isVat
								? { vatId: this.getNodeParameter('vatId', i) as string }
								: { participant: this.getNodeParameter('participant', i) as string },
							json: true,
						},
						i,
						'partner',
					);
					out.push({ json: res.body.result, pairedItem: paired });
					continue;
				}

				// ── Payment ──────────────────────────────────────────────────────
				if (resource === 'payment') {
					if (operation === 'lookUpBic') {
						const res = await call<IDataObject>(
							{
								method: 'GET',
								url: `${baseUrl}/api/v1/payments/bank-lookup`,
								qs: {
									country: (this.getNodeParameter('country', i) as string).trim().toUpperCase(),
									bankCode: (this.getNodeParameter('bankCode', i) as string).replace(/\s+/g, ''),
								},
								json: true,
							},
							i,
							'bicLookup',
						);
						out.push({ json: res.body, pairedItem: paired });
						continue;
					}

					if (operation === 'validateFile') {
						const profile = this.getNodeParameter('profile', i) as string;
						const body = await postFile(
							i,
							'/api/v1/payments/validate',
							'payment file',
							profile === 'auto' ? {} : { profile },
						);
						const simplify = this.getNodeParameter('simplify', i) as boolean;
						out.push({
							json: simplify
								? simplifyPaymentValidation(body.result)
								: (body as unknown as IDataObject),
							pairedItem: paired,
						});
						continue;
					}

					// createSepaFile / createForeignFile
					const foreign = operation === 'createForeignFile';
					const run = jsonParameter(
						this.getNode(),
						this.getNodeParameter('paymentRun', i),
						'Payment Run (JSON)',
						i,
						'paymentRun',
					);
					const res = await call<{
						xml: string;
						filename: string;
						summary?: IDataObject;
						warnings?: IDataObject[];
						verification?: string;
					}>(
						{
							method: 'POST',
							url: `${baseUrl}/api/v1/payments/${foreign ? 'axz' : 'sepa'}`,
							body: JSON.parse(run) as IDataObject,
							json: true,
							// The JSON envelope carries the XML plus summary and warnings.
							// The API returns it only for an explicit application/json
							// without */*, so the header is set here.
							headers: { Accept: 'application/json' },
						},
						i,
						foreign ? 'paymentForeign' : 'paymentCreate',
					);
					const envelope = res.body;
					if (typeof envelope?.xml !== 'string' || !envelope.xml.trimStart().startsWith('<')) {
						throw new NodeOperationError(
							this.getNode(),
							`The finisma API response contains no payment file [item ${i}]`,
							{
								itemIndex: i,
								description: 'Expected a pain.001 XML document in the field "xml" of the response.',
							},
						);
					}
					const bytes = Buffer.from(envelope.xml, 'utf8');
					const filename = envelope.filename || (foreign ? 'axz-ausland.xml' : 'sepa-inland.xml');
					const outField = this.getNodeParameter('outputBinaryPropertyName', i) as string;
					out.push({
						json: {
							filename,
							bytes: bytes.length,
							format: 'xml',
							payments: envelope.summary?.payments,
							controlSum: envelope.summary?.controlSum,
							requestedExecutionDate: envelope.summary?.requestedExecutionDate,
							warnings: envelope.warnings ?? [],
							verification: envelope.verification,
						},
						binary: {
							[outField]: await this.helpers.prepareBinaryData(bytes, filename, 'application/xml'),
						},
						pairedItem: paired,
					});
					continue;
				}

				// ── Bank statement ───────────────────────────────────────────────
				if (resource === 'bankStatement') {
					const parse = operation === 'parse';
					const body = await postFile(
						i,
						parse ? '/api/v1/statements/parse' : '/api/v1/statements/validate',
						'bank statement',
					);
					const simplify = this.getNodeParameter('simplify', i) as boolean;
					if (!simplify) {
						out.push({ json: body as unknown as IDataObject, pairedItem: paired });
					} else if (parse) {
						for (const row of simplifyStatementParse(body.result)) {
							out.push({ json: row, pairedItem: paired });
						}
					} else {
						out.push({ json: simplifyStatementValidation(body.result), pairedItem: paired });
					}
					continue;
				}

				// ── Invoice ──────────────────────────────────────────────────────
				// The XML output has no visual document. The source PDF is neither
				// required nor read there, so a workflow that only passes structured
				// data from another system works without a PDF.
				const outputFormat =
					operation === 'create' ? (this.getNodeParameter('outputFormat', i) as string) : 'pdf';
				const needsSourcePdf = operation !== 'create' || outputFormat !== 'xml';

				const form = new FormData();
				let sourceFilename = 'invoice.pdf';
				let pdfField = '';

				if (needsSourcePdf) {
					pdfField = this.getNodeParameter('binaryPropertyName', i) as string;
					const pdf = await readBinary(i, pdfField, 'PDF');
					sourceFilename = pdf.fileName ?? 'invoice.pdf';
					form.append(
						'pdf',
						new Blob([new Uint8Array(pdf.buffer)], { type: 'application/pdf' }),
						sourceFilename,
					);
				}

				if (operation === 'verify' || operation === 'extract') {
					const res = await call<IDataObject>(
						{
							method: 'POST',
							url: `${baseUrl}/api/v1/${operation === 'verify' ? 'verify' : 'extractions'}`,
							body: form,
							json: true,
						},
						i,
						operation === 'verify' ? 'invoiceVerify' : 'invoiceExtract',
					);
					out.push({ json: res.body, pairedItem: paired });
					continue;
				}

				// ── create ──────────────────────────────────────────────────────
				const invoiceJson = jsonParameter(
					this.getNode(),
					this.getNodeParameter('invoice', i),
					'Invoice Data (JSON)',
					i,
					'invoice',
				);
				form.append('invoice', new Blob([invoiceJson], { type: 'application/json' }));

				// Attachments go out as additional file parts with the same field
				// name. They must NOT go into the invoice data: the EN 16931 schema
				// has no attachments field, and an entry there would be dropped
				// silently during validation.
				const attachmentFields = [
					...new Set(
						(this.getNodeParameter('attachmentFields', i) as string)
							.split(',')
							.map((f) => f.trim())
							.filter(Boolean),
					),
				]
					// The PDF field is the invoice itself and is never attached,
					// otherwise the invoice would contain itself. Skipped instead of
					// rejected: a field list built from $binary always contains it,
					// and that should just work. Without a source PDF there is
					// nothing to skip.
					.filter((f) => !needsSourcePdf || f !== pdfField);
				const attachmentDescriptions = (
					this.getNodeParameter('attachmentDescriptions', i) as string
				)
					.split(',')
					.map((d) => d.trim());
				for (const [n, field] of attachmentFields.entries()) {
					const meta = items[i].binary?.[field];
					if (!meta) {
						throw new NodeOperationError(
							this.getNode(),
							`The input item has no binary field "${field}" [item ${i}]`,
							{
								itemIndex: i,
								description:
									"Every name in 'Attachment Binary Fields' must be a binary field of the input item. Check the spelling or remove the name from the list.",
							},
						);
					}
					const buf = await this.helpers.getBinaryDataBuffer(i, field);
					form.append(
						'attachments',
						new Blob([new Uint8Array(buf)], {
							type: meta.mimeType || 'application/octet-stream',
						}),
						meta.fileName ?? field,
					);
					// Same position as the file part. An empty entry lets the API
					// fall back to the file name.
					form.append('attachmentDescriptions', attachmentDescriptions[n] ?? '');
				}

				const requestedName = this.getNodeParameter('filename', i) as string;
				const filename =
					requestedName ||
					sourceFilename.replace(/\.pdf$/i, '') +
						(outputFormat === 'xml' ? '.xml' : '-zugferd.pdf');
				form.append('filename', filename);

				const response = await call<Buffer | ArrayBuffer>(
					{
						method: 'POST',
						url:
							outputFormat === 'xml'
								? `${baseUrl}/api/v1/invoices?format=xml`
								: `${baseUrl}/api/v1/invoices`,
						body: form,
						// The response is the raw file, not JSON. The Accept header must be
						// set explicitly: otherwise n8n sends the axios default
						// "application/json, text/plain, */*", and the API's content
						// negotiation answers with the base64 JSON envelope instead.
						headers: {
							Accept: outputFormat === 'xml' ? 'application/xml' : 'application/pdf',
						},
						encoding: 'arraybuffer',
						json: false,
					},
					i,
					'invoiceCreate',
				);

				const bytes = Buffer.isBuffer(response.body)
					? response.body
					: Buffer.from(response.body as ArrayBuffer);
				// Safety net: anything other than the expected file must not pass
				// as binary data. A .pdf that actually contained JSON was once only
				// noticed when someone opened it. For XML, the start of the document
				// counts: either the declaration or the root element.
				const head = bytes.subarray(0, 200).toString('utf8').trimStart();
				const matches =
					outputFormat === 'xml'
						? head.startsWith('<')
						: bytes.subarray(0, 5).toString('latin1') === '%PDF-';
				if (!matches) {
					throw new NodeOperationError(
						this.getNode(),
						outputFormat === 'xml'
							? `The finisma API response is not an XML document [item ${i}]`
							: `The finisma API response is not a PDF file [item ${i}]`,
						{
							itemIndex: i,
							description: `Expected the ${
								outputFormat === 'xml' ? 'CII XML' : 'ZUGFeRD PDF'
							} of the invoice. The response starts with: ${head.slice(0, 200)}`,
						},
					);
				}
				const outField = this.getNodeParameter('outputBinaryPropertyName', i) as string;

				out.push({
					json: { filename, bytes: bytes.length, format: outputFormat },
					binary: {
						[outField]: await this.helpers.prepareBinaryData(
							bytes,
							filename,
							outputFormat === 'xml' ? 'application/xml' : 'application/pdf',
						),
					},
					pairedItem: paired,
				});
			} catch (error) {
				if (this.continueOnFail()) {
					out.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				// NodeOperationError returns an existing NodeOperationError unchanged,
				// so messages built above keep their description.
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}

		return [out];
	}
}
