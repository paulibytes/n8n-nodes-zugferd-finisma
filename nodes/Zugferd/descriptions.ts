import type { INodeProperties } from 'n8n-workflow';

/**
 * Parameters of the node, grouped by resource. Existing workflows have no
 * 'resource' parameter: the default 'invoice' and the unchanged operation
 * values 'create' and 'verify' keep them running as before.
 */

const SIMPLIFY_DESCRIPTION =
	'Whether to return a simplified version of the response instead of the raw data';

export const resourceProperty: INodeProperties = {
	displayName: 'Resource',
	name: 'resource',
	type: 'options',
	noDataExpression: true,
	options: [
		{ name: 'Bank Statement', value: 'bankStatement' },
		{ name: 'Invoice', value: 'invoice' },
		{ name: 'Partner', value: 'partner' },
		{ name: 'Payment', value: 'payment' },
	],
	default: 'invoice',
};

export const operationProperties: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['invoice'] } },
		options: [
			{
				name: 'Create',
				value: 'create',
				description:
					'Combine a PDF and invoice data into a ZUGFeRD e-invoice, or create the XML only',
				action: 'Create invoice',
			},
			{
				name: 'Extract Data',
				value: 'extract',
				description: 'Read the EN 16931 invoice data from a PDF invoice',
				action: 'Extract invoice data',
			},
			{
				name: 'Verify',
				value: 'verify',
				description: 'Check an existing e-invoice against EN 16931 and PDF/A-3 (free of charge)',
				action: 'Verify invoice',
			},
		],
		default: 'create',
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['partner'] } },
		options: [
			{
				name: 'Check Peppol Participant',
				value: 'checkPeppol',
				description: 'Check whether a business partner can receive e-invoices over Peppol',
				action: 'Check peppol participant',
			},
			{
				name: 'Check VAT ID',
				value: 'checkVatId',
				description: 'Check a VAT ID live against VIES, the EU confirmation service',
				action: 'Check VAT ID',
			},
		],
		default: 'checkVatId',
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['payment'] } },
		options: [
			{
				name: 'Create Foreign Payment File',
				value: 'createForeignFile',
				description:
					'Create a foreign payment file (pain.001, German AXZ format) from a payment run',
				action: 'Create foreign payment file',
			},
			{
				name: 'Create SEPA File',
				value: 'createSepaFile',
				description: 'Create a SEPA credit transfer file (pain.001) from a payment run',
				action: 'Create SEPA file',
			},
			{
				name: 'Look Up BIC',
				value: 'lookUpBic',
				description: 'Find the BIC and bank name for a German bank code',
				action: 'Look up BIC',
			},
			{
				name: 'Validate File',
				value: 'validateFile',
				description: 'Check an existing payment file (pain.001, SEPA or foreign payment)',
				action: 'Validate payment file',
			},
		],
		default: 'createSepaFile',
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['bankStatement'] } },
		options: [
			{
				name: 'Parse',
				value: 'parse',
				description:
					'Read a bank statement (camt.052, camt.053, camt.054 or camt.086) into structured data',
				action: 'Parse bank statement',
			},
			{
				name: 'Validate',
				value: 'validate',
				description:
					'Check a bank statement (camt.052, camt.053, camt.054 or camt.086) against rules and schema',
				action: 'Validate bank statement',
			},
		],
		default: 'validate',
	},
];

// ── Invoice ────────────────────────────────────────────────────────────────

const showInvoiceCreate = { show: { resource: ['invoice'], operation: ['create'] } };

export const invoiceProperties: INodeProperties[] = [
	{
		displayName: 'Output Format',
		name: 'outputFormat',
		type: 'options',
		options: [
			{
				name: 'ZUGFeRD PDF',
				value: 'pdf',
				description: 'PDF/A-3 with embedded CII XML. Needs a source PDF as the visual document.',
			},
			{
				name: 'XML Only',
				value: 'xml',
				description:
					'CII XML without a visual document, for public-sector portals and further processing. Needs an active finisma subscription or credits.',
			},
		],
		default: 'pdf',
		displayOptions: showInvoiceCreate,
		description:
			'XML only skips the source PDF and the embedding step, so the response is much faster',
	},
	// The same parameter name appears more than once with mutually exclusive
	// display rules, so each operation gets its own description. Workflows keep
	// the stored value because the name does not change.
	{
		displayName: 'Input Binary Field',
		name: 'binaryPropertyName',
		type: 'string',
		default: 'data',
		required: true,
		displayOptions: {
			show: { resource: ['invoice'], operation: ['create'], outputFormat: ['pdf'] },
		},
		description: 'Name of the binary field of the input item that contains the source PDF',
	},
	{
		displayName: 'Input Binary Field',
		name: 'binaryPropertyName',
		type: 'string',
		default: 'data',
		required: true,
		displayOptions: { show: { resource: ['invoice'], operation: ['verify', 'extract'] } },
		description: 'Name of the binary field of the input item that contains the PDF invoice',
	},
	{
		displayName: 'Invoice Data (JSON)',
		name: 'invoice',
		type: 'json',
		default: '{}',
		required: true,
		displayOptions: showInvoiceCreate,
		description:
			"Invoice data according to EN 16931. See the 'Invoice' schema in the API documentation at https://finisma.de/api-docs.",
	},
	{
		displayName: 'Attachment Binary Fields',
		name: 'attachmentFields',
		type: 'string',
		default: '',
		displayOptions: showInvoiceCreate,
		placeholder: 'e.g. timesheet,serviceReport',
		description:
			"Comma-separated names of further binary fields of the item to embed in the invoice as supporting documents. Leave empty if there are none. The field set in 'Input Binary Field' is always skipped, so the invoice never ends up attached to itself. Allowed are PDF, PNG, JPEG, CSV, XLSX, ODS and XML, up to 10 MB each.",
	},
	{
		displayName: 'Attachment Descriptions',
		name: 'attachmentDescriptions',
		type: 'string',
		default: '',
		displayOptions: showInvoiceCreate,
		placeholder: 'e.g. Timesheet March 2026,Service Report',
		description:
			"Comma-separated descriptions of the attachments (BT-123), in the same order as 'Attachment Binary Fields'. Without a description, the recipient only sees the file name. A description cannot contain a comma.",
	},
	{
		displayName: 'Output File Name',
		name: 'filename',
		type: 'string',
		default: '',
		displayOptions: showInvoiceCreate,
		placeholder: 'e.g. invoice-2026-001.pdf',
		description:
			'Optional. Leave empty to reuse the name of the input file. The extension follows the output format.',
	},
	{
		displayName: 'Output Binary Field',
		name: 'outputBinaryPropertyName',
		type: 'string',
		default: 'data',
		displayOptions: showInvoiceCreate,
		description:
			'Name of the binary field that receives the result, either the ZUGFeRD PDF or the XML depending on the output format',
	},
];

// ── Partner ────────────────────────────────────────────────────────────────

export const partnerProperties: INodeProperties[] = [
	{
		displayName: 'VAT ID',
		name: 'vatId',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'e.g. DE325821677',
		displayOptions: { show: { resource: ['partner'], operation: ['checkVatId'] } },
		description:
			'VAT ID with country prefix. Spaces, dots and hyphens are ignored. A status of "unavailable" means VIES did not answer, not that the ID is invalid.',
	},
	{
		displayName: 'Participant ID',
		name: 'participant',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'e.g. 0088:4399901550926',
		displayOptions: { show: { resource: ['partner'], operation: ['checkPeppol'] } },
		description:
			'Full Peppol ID, a bare GLN, a German VAT ID or a Leitweg-ID. Not being registered is a normal result: the invoice can still go out as a ZUGFeRD PDF by email.',
	},
];

// ── Payment ────────────────────────────────────────────────────────────────

const showPaymentCreate = {
	show: { resource: ['payment'], operation: ['createSepaFile', 'createForeignFile'] },
};

export const paymentProperties: INodeProperties[] = [
	{
		displayName: 'Payment Run (JSON)',
		name: 'paymentRun',
		type: 'json',
		default: '{}',
		required: true,
		displayOptions: showPaymentCreate,
		description:
			"Debtor account, execution date and payments. See the 'PaymentRun' schema in the API documentation at https://finisma.de/api-docs.",
	},
	{
		displayName: 'Output Binary Field',
		name: 'outputBinaryPropertyName',
		type: 'string',
		default: 'data',
		displayOptions: showPaymentCreate,
		description: 'Name of the binary field that receives the payment file (XML)',
	},
	{
		displayName: 'Country',
		name: 'country',
		type: 'string',
		default: 'DE',
		required: true,
		displayOptions: { show: { resource: ['payment'], operation: ['lookUpBic'] } },
		description:
			'Two-letter country code of the bank. Only DE returns a result, other countries return "unsupported_country".',
	},
	{
		displayName: 'Bank Code',
		name: 'bankCode',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'e.g. 10070000',
		displayOptions: { show: { resource: ['payment'], operation: ['lookUpBic'] } },
		description: 'German bank code (Bankleitzahl), 8 digits',
	},
	{
		displayName: 'Input Binary Field',
		name: 'binaryPropertyName',
		type: 'string',
		default: 'data',
		required: true,
		displayOptions: { show: { resource: ['payment'], operation: ['validateFile'] } },
		description: 'Name of the binary field of the input item that contains the pain.001 XML file',
	},
	{
		displayName: 'Profile',
		name: 'profile',
		type: 'options',
		options: [
			{
				name: 'Detect Automatically',
				value: 'auto',
				description: 'Let finisma detect SEPA or foreign payment from the file',
			},
			{ name: 'Foreign Payment (AXZ)', value: 'axz' },
			{ name: 'SEPA Credit Transfer', value: 'sct' },
		],
		default: 'auto',
		displayOptions: { show: { resource: ['payment'], operation: ['validateFile'] } },
		description: 'Rule set for the check',
	},
	{
		displayName: 'Simplify',
		name: 'simplify',
		type: 'boolean',
		default: true,
		displayOptions: { show: { resource: ['payment'], operation: ['validateFile'] } },
		description: SIMPLIFY_DESCRIPTION,
	},
];

// ── Bank statement ─────────────────────────────────────────────────────────

export const bankStatementProperties: INodeProperties[] = [
	{
		displayName: 'Input Binary Field',
		name: 'binaryPropertyName',
		type: 'string',
		default: 'data',
		required: true,
		displayOptions: { show: { resource: ['bankStatement'] } },
		description:
			'Name of the binary field of the input item that contains the camt XML file or a ZIP archive with several files',
	},
	{
		displayName: 'Simplify',
		name: 'simplify',
		type: 'boolean',
		default: true,
		displayOptions: { show: { resource: ['bankStatement'] } },
		description: SIMPLIFY_DESCRIPTION,
	},
];
