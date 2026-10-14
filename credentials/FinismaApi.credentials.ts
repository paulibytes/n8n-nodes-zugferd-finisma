import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

/**
 * API key of a finisma account. Verifying works with every valid key. Creating
 * invoices also depends on the account (subscription, credits or the free daily
 * quota with watermark); the server decides that, not the key.
 */
export class FinismaApi implements ICredentialType {
	name = 'finismaApi';

	displayName = 'Finisma API';

	icon = {
		light: 'file:../nodes/Zugferd/finisma.svg',
		dark: 'file:../nodes/Zugferd/finisma.dark.svg',
	} as const;

	documentationUrl = 'https://github.com/paulibytes/n8n-nodes-zugferd-finisma#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'Create it in your finisma account in the section "API und Anwendungen" (API and apps). It starts with "fnsm_" and is shown only once.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	// GET /api/v1/me returns account and subscription status and creates nothing.
	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://finisma.de',
			url: '/api/v1/me',
		},
	};
}
