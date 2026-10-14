import type { ICredentialType, INodeProperties } from 'n8n-workflow';

/**
 * OAuth 2.1 instead of an API key: the user clicks "Connect my account" in n8n,
 * signs in to finisma and grants access. n8n then holds an access token and
 * renews it with the refresh token.
 *
 * The grant type is fixed to PKCE: finisma requires code_challenge_method=S256
 * for every client, confidential ones included (OAuth 2.1). Users get the
 * client ID and secret by registering a client, see
 * https://finisma.de/entwickler/oauth.
 */
export class FinismaOAuth2Api implements ICredentialType {
	name = 'finismaOAuth2Api';

	extends = ['oAuth2Api'];

	displayName = 'Finisma OAuth2 API';

	icon = {
		light: 'file:../nodes/Zugferd/finisma.svg',
		dark: 'file:../nodes/Zugferd/finisma.dark.svg',
	} as const;

	documentationUrl = 'https://github.com/paulibytes/n8n-nodes-zugferd-finisma#oauth2';

	properties: INodeProperties[] = [
		{
			displayName: 'Grant Type',
			name: 'grantType',
			type: 'hidden',
			default: 'pkce',
		},
		{
			displayName: 'Authorization URL',
			name: 'authUrl',
			type: 'hidden',
			default: 'https://finisma.de/api/oauth/authorize',
		},
		{
			displayName: 'Access Token URL',
			name: 'accessTokenUrl',
			type: 'hidden',
			default: 'https://finisma.de/api/oauth/token',
		},
		{
			displayName: 'Scope',
			name: 'scope',
			type: 'hidden',
			default: 'invoice:verify invoice:create',
		},
		{
			displayName: 'Auth URI Query Parameters',
			name: 'authQueryParameters',
			type: 'hidden',
			default: '',
		},
		{
			displayName: 'Authentication',
			name: 'authentication',
			type: 'hidden',
			default: 'body',
		},
	];
}
