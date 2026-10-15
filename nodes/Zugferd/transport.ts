import type { INode } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

/** Which part of the node made the call. Selects the hint shown with an API message. */
export type CallContext =
	| 'invoiceCreate'
	| 'invoiceVerify'
	| 'invoiceExtract'
	| 'partner'
	| 'paymentCreate'
	| 'paymentForeign'
	| 'bicLookup'
	| 'fileCheck';

/**
 * Explains what to do next for the status codes the finisma API documents.
 * Shown as the error description below the message.
 */
export function hintForStatus(
	statusCode: number,
	code: string | undefined,
	context: CallContext,
): string | undefined {
	if (statusCode === 401) {
		return 'Check the API key in the credential, or reconnect the OAuth2 credential.';
	}
	if (code === 'insufficient_scope') {
		return 'Reconnect the OAuth2 credential and grant access to creating and verifying invoices.';
	}
	if (code === 'payment_required' || statusCode === 402) {
		return 'The free quota of this operation is used up: checks reset at midnight, parsing at the start of the month (Europe/Berlin, see the Retry-After header). The finisma payments subscription removes the limit. Otherwise top up credits at https://finisma.de/konto: 1 credit buys 10 checks, parsing costs 1 credit per call.';
	}
	if (code === 'subscription_required') {
		if (context === 'paymentForeign') {
			return 'Foreign payment files need the finisma payments subscription with the foreign payments add-on.';
		}
		if (context === 'paymentCreate' || context === 'bicLookup') {
			return 'This operation needs the finisma payments subscription.';
		}
		if (context === 'invoiceExtract') {
			return 'Extracting invoice data needs an active finisma subscription or credits (1 credit per call).';
		}
		if (context === 'fileCheck') {
			return 'This operation needs a finisma account. Connect the credential of an account.';
		}
		return 'This needs an active finisma subscription or credits. The ZUGFeRD PDF output also works without them, with a watermark and a daily limit.';
	}
	if (code === 'free_quota_exhausted') {
		return 'The free daily quota is used up. It resets at midnight (see the Retry-After header). A subscription or credits remove the limit.';
	}
	if (statusCode === 413 || code === 'payload_too_large') {
		return 'The file is larger than 10 MB. Send the files of a ZIP archive one by one, or split the archive.';
	}
	if (statusCode === 429) {
		return 'Too many requests. Wait a moment and run the node again.';
	}
	if (statusCode === 422 && (context === 'paymentCreate' || context === 'paymentForeign')) {
		return "The payment run breaks the rules listed above, so no file was created. Correct 'Payment Run (JSON)' and run the node again.";
	}
	if (statusCode === 502 && context === 'invoiceCreate') {
		return 'The invoice could not be created, or the generated invoice did not pass the final check. No credit or free quota was used. Run the node again later or contact finisma.';
	}
	if (statusCode === 502 && (context === 'paymentCreate' || context === 'paymentForeign')) {
		return 'The created file did not pass the final check, or the check was not reachable. No file was delivered. Run the node again later or contact finisma.';
	}
	if (statusCode === 400) {
		if (context === 'invoiceCreate') {
			return "Compare 'Invoice Data (JSON)' with the 'Invoice' schema at https://finisma.de/api-docs. A logo must be PNG, JPEG or SVG up to 500 KB, and an SVG must not contain scripts or links to other files.";
		}
		if (context === 'paymentCreate' || context === 'paymentForeign') {
			return "Compare 'Payment Run (JSON)' with the 'PaymentRun' schema at https://finisma.de/api-docs.";
		}
		if (context === 'fileCheck') {
			return "Check that 'Input Binary Field' contains a supported file: pain.001 for payment files, camt.052, camt.053, camt.054 (versions .02 and .08) or camt.086 (.01 to .05) for bank statements, or a ZIP archive of them.";
		}
		if (context === 'invoiceVerify' || context === 'invoiceExtract') {
			return "Check that 'Input Binary Field' contains a PDF file.";
		}
	}
	return undefined;
}

/**
 * Turns an API error response into a readable node error.
 *
 * Some operations request the raw response bytes because a successful
 * response is a PDF or XML file. An error response therefore arrives as bytes
 * too, and n8n would show an array of numbers instead of the message. The
 * message matters here: it names the field that is missing or does not match
 * the schema.
 */
export function apiError(
	node: INode,
	statusCode: number,
	raw: unknown,
	itemIndex: number,
	context: CallContext,
): NodeOperationError {
	let body: unknown = raw;
	if (Buffer.isBuffer(raw)) {
		body = raw.toString('utf8');
	} else if (raw instanceof ArrayBuffer) {
		body = Buffer.from(raw).toString('utf8');
	}
	if (typeof body === 'string') {
		try {
			body = JSON.parse(body);
		} catch {
			// Not JSON: keep the plain text as the message.
		}
	}

	const obj = (typeof body === 'object' && body !== null ? body : {}) as {
		error?: unknown;
		code?: unknown;
		details?: unknown;
	};
	const message =
		typeof obj.error === 'string'
			? obj.error
			: typeof body === 'string' && body.length > 0
				? body.slice(0, 300)
				: 'No message in the response.';
	const code = typeof obj.code === 'string' ? obj.code : undefined;

	// For schema violations and payment rules, details lists the field paths.
	// Shortened so the message stays readable in the node.
	let details: string | undefined;
	if (Array.isArray(obj.details)) {
		const parts = obj.details
			.map((d) => {
				const e = d as { path?: unknown; message?: unknown; name?: unknown; reason?: unknown };
				if (typeof e?.path === 'string' && typeof e?.message === 'string') {
					return `${e.path}: ${e.message}`;
				}
				if (typeof e?.name === 'string' && typeof e?.reason === 'string') {
					return `${e.name}: ${e.reason}`;
				}
				if (typeof e?.message === 'string') return e.message;
				return typeof d === 'string' ? d : JSON.stringify(d);
			})
			.filter(Boolean);
		if (parts.length > 0) {
			const shown = parts.slice(0, 12).join('; ');
			details = parts.length > 12 ? `${shown} … (${parts.length} findings in total)` : shown;
		}
	}

	const description =
		[details, hintForStatus(statusCode, code, context)].filter(Boolean).join(' ') || undefined;

	return new NodeOperationError(
		node,
		`finisma API returned HTTP ${statusCode}${code ? ` [${code}]` : ''}: ${message} [item ${itemIndex}]`,
		{ itemIndex, description },
	);
}

/**
 * Reads a JSON parameter. Depending on the input, the json parameter type
 * returns a string or an object.
 */
export function jsonParameter(
	node: INode,
	value: unknown,
	displayName: string,
	itemIndex: number,
	exampleField: string,
): string {
	if (typeof value !== 'string') return JSON.stringify(value);
	try {
		JSON.parse(value);
	} catch {
		throw new NodeOperationError(
			node,
			`'${displayName}' does not contain valid JSON [item ${itemIndex}]`,
			{
				itemIndex,
				description: `Check the JSON syntax. To pass an object from a previous node, use an expression such as {{ JSON.stringify($json.${exampleField}) }}.`,
			},
		);
	}
	return value;
}
