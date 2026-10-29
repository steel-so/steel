import type {
  IAuthenticateGeneric,
  ICredentialTestRequest,
  ICredentialType,
  INodeProperties,
} from 'n8n-workflow'

/**
 * Personal API token of the Steel API v1 (`stl_pat_...`). The same token the
 * Steel CLI uses; create one in Steel under Configurações › Segurança › Tokens
 * de API. The token carries the workspace, the modules and the scope
 * (`api:read` / `api:write`), so nothing else is asked here.
 */
export class SteelApi implements ICredentialType {
  name = 'steelApi'
  displayName = 'Steel API'
  documentationUrl = 'https://homologacao.stratustelecom.com.br/dev/n8n'
  icon = 'file:steel.svg' as const

  properties: INodeProperties[] = [
    {
      displayName: 'Steel URL',
      name: 'baseUrl',
      type: 'string',
      default: '',
      placeholder: 'https://homologacao.stratustelecom.com.br',
      required: true,
      description: 'Address of your Steel, without a trailing slash',
    },
    {
      displayName: 'API Token',
      name: 'token',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      required: true,
      placeholder: 'stl_pat_...',
      description:
        'Personal token with the api:read scope (api:write to create or change records and to subscribe webhooks)',
    },
  ]

  authenticate: IAuthenticateGeneric = {
    type: 'generic',
    properties: {
      headers: { Authorization: '=Bearer {{$credentials.token}}' },
    },
  }

  test: ICredentialTestRequest = {
    request: {
      baseURL: '={{$credentials.baseUrl}}',
      url: '/api/v1/me',
    },
  }
}
