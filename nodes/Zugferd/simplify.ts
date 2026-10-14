import type { IDataObject } from 'n8n-workflow';

/**
 * Simplified outputs (n8n UX guideline: at most 10 fields, the most used
 * first, nested fields flattened). The raw output is the 'result' object of
 * the finisma API response. Field names follow the finisma REST reference:
 * https://finisma.de/entwickler/rest
 */

type Obj = Record<string, unknown>;

const asObj = (v: unknown): Obj => (typeof v === 'object' && v !== null ? (v as Obj) : {});
const asArr = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Obj[]) : []);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

/** "CODE: message" for rule findings, with line and column for schema findings. */
function findingText(f: Obj, prefix = ''): string {
	const line =
		typeof f.line === 'number'
			? ` (line ${f.line}${typeof f.column === 'number' ? `, column ${f.column}` : ''})`
			: '';
	return `${prefix}${String(f.code ?? '')}: ${String(f.message ?? '')}${line}`;
}

function bySeverity(findings: Obj[], severity: string, prefix = ''): string[] {
	return findings.filter((f) => f.severity === severity).map((f) => findingText(f, prefix));
}

function schemaValid(xsd: Obj): boolean | null {
	return xsd.available === true ? xsd.valid === true : null;
}

/** Payment > Validate File. */
export function simplifyPaymentValidation(result: Obj): IDataObject {
	const summary = asObj(result.summary);
	const xsd = asObj(result.xsd);
	const findings = asArr(result.findings);
	const xsdFindings = asArr(xsd.findings);
	const billing = asObj(result.billing);
	return {
		verdict: result.verdict as string,
		profile: result.profile as string,
		version: `pain.001.001.${String(result.version ?? '')}`,
		payments: summary.payments as number,
		total: asArr(summary.currencies)
			.map((c) => `${String(c.total)} ${String(c.currency)}`)
			.join(', '),
		schemaValid: schemaValid(xsd),
		errors: [...bySeverity(findings, 'error'), ...bySeverity(xsdFindings, 'error', 'Schema ')],
		warnings: [
			...bySeverity(findings, 'warning'),
			...bySeverity(xsdFindings, 'warning', 'Schema '),
		],
		billedVia: billing.via as string,
		freeRemaining: (billing.freeRemaining ?? null) as number | null,
	};
}

/** Bank Statement > Validate: one item per call. */
export function simplifyStatementValidation(result: Obj): IDataObject {
	const files = asArr(result.files);
	const billing = asObj(result.billing);
	const errors: string[] = [];
	const warnings: string[] = [];
	for (const f of files) {
		const prefix = files.length > 1 ? `${String(f.name)}: ` : '';
		const findings = asArr(f.findings);
		const xsdFindings = asArr(asObj(f.xsd).findings);
		errors.push(
			...bySeverity(findings, 'error', prefix),
			...bySeverity(xsdFindings, 'error', `${prefix}Schema `),
		);
		warnings.push(
			...bySeverity(findings, 'warning', prefix),
			...bySeverity(xsdFindings, 'warning', `${prefix}Schema `),
		);
	}
	const delivery = asArr(result.deliveryFindings);
	errors.push(...bySeverity(delivery, 'error'));
	warnings.push(...bySeverity(delivery, 'warning'));
	const schemas = files.map((f) => schemaValid(asObj(f.xsd)));
	return {
		verdict: result.verdict as string,
		files: files.map((f) => `${String(f.name)} (${String(f.message)}.001.${String(f.version)})`),
		schemaValid: schemas.includes(null) ? null : schemas.every(Boolean),
		errors,
		warnings,
		skipped: asArr(result.skipped).map((s) => `${String(s.name)}: ${String(s.reason)}`),
		billedVia: billing.via as string,
		freeRemaining: (billing.freeRemaining ?? null) as number | null,
	};
}

/**
 * Bank Statement > Parse: one item per booking (camt.052/053/054, one per
 * transaction for batch bookings) or per service (camt.086).
 */
export function simplifyStatementParse(result: Obj): IDataObject[] {
	const rows: IDataObject[] = [];
	for (const file of asArr(result.files)) {
		const c086 = file.message === 'camt.086';
		for (const stmt of asArr(file.statements)) {
			if (c086) {
				for (const svc of asArr(stmt.services)) {
					const charge = asObj(svc.charge);
					const unit = asObj(svc.unitPrice);
					const tax = asObj(asObj(svc.tax).amount);
					rows.push({
						statementId: str(stmt.id) ?? null,
						accountIban: str(asObj(stmt.account).iban) ?? str(asObj(stmt.account).otherId) ?? null,
						serviceId: str(svc.id) ?? null,
						description: str(svc.description) ?? null,
						volume: (svc.volume ?? null) as number | null,
						unitPrice: (unit.value ?? null) as number | null,
						charge: (charge.value ?? null) as number | null,
						currency: str(charge.currency) ?? str(unit.currency) ?? null,
						tax: (tax.value ?? null) as number | null,
						paymentMethod: str(svc.paymentMethod) ?? null,
					});
				}
				continue;
			}
			const accountIban = str(asObj(stmt.account).iban) ?? str(asObj(stmt.account).otherId) ?? null;
			for (const entry of asArr(stmt.entries)) {
				const txs = asArr(entry.transactions);
				const btc = asObj(entry.bankTxCode);
				const parts = txs.length > 0 ? txs : [{} as Obj];
				for (const tx of parts) {
					const cp = asObj(tx.counterparty);
					const rem = asObj(tx.remittance);
					const dk = asObj(rem.dkKeys);
					const txBtc = asObj(tx.bankTxCode);
					const unstructured = asArr(rem.unstructured as unknown)
						.map(String)
						.join(' ');
					rows.push({
						accountIban,
						bookingDate: str(entry.bookingDate) ?? str(entry.valueDate) ?? null,
						amount: (tx.amount ?? entry.amount) as number,
						currency: (str(tx.currency) ?? entry.currency) as string,
						creditDebit: entry.creditDebit as string,
						counterpartyName: str(cp.name) ?? null,
						counterpartyIban: str(cp.iban) ?? str(cp.otherId) ?? null,
						remittanceInfo: str(dk.svwz) ?? (unstructured || str(entry.additionalInfo) || null),
						endToEndId: str(asObj(tx.refs).endToEndId) ?? null,
						bankTransactionCode:
							str(txBtc.gvc) ??
							str(btc.gvc) ??
							([btc.domain, btc.family, btc.subFamily].filter(Boolean).join('/') || null),
					});
				}
			}
		}
	}
	return rows;
}
