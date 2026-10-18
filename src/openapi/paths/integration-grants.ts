import { z } from 'zod'
import { MCP_SCOPES } from '@/src/lib/mcp/grant'
import {
  IntegrationModuleSchema,
  OAuthConsentSchema,
} from '@/src/schemas/integration-grant.schema'
import type { JsonSchema } from '../json-schema'
import type { ErrorEntry, OpenApiRegistry, RouteConfig } from '../registry'

/**
 * Integration identity (ADR 0033): the OAuth 2.1 provider that MCP clients
 * use, the consent answer and the user's "Apps conectados".
 */

const TAG = 'Apps conectados (OAuth)' as const

const OAUTH_NOTE =
  'Endpoint do plugin `@better-auth/oauth-provider` (catch-all `/api/auth/[...all]`); a resposta segue o OAuth 2.1, **fora** do envelope padrão do Steel. Descoberta: `/.well-known/oauth-authorization-server` (servidor) e `/.well-known/oauth-protected-resource` (recurso `/api/mcp`). Rate limit do app por IP e rota.'

const IntegrationGrantDTO = z.object({
  id: z.string(),
  client: z.object({
    clientId: z.string(),
    name: z.string().nullable(),
    icon: z.string().nullable(),
    uri: z.string().nullable(),
  }),
  workspace: z.object({ id: z.string(), name: z.string(), slug: z.string() }),
  redirectHost: z.string().nullable().meta({
    description:
      'Host do `redirect_uri` mostrado na tela de consentimento (para onde o código foi). O `client.name` é declarado pelo próprio app; o host é o que o identifica. Nulo em concessões anteriores a esse registro.',
  }),
  scopes: z.array(z.enum(MCP_SCOPES)),
  modules: z.array(IntegrationModuleSchema),
  lastUsedAt: z
    .string()
    .nullable()
    .meta({ description: 'Atualizado no máximo uma vez por minuto.' }),
  createdAt: z.string(),
})

const McpUsageDTO = z
  .object({ last7Days: z.number().int(), last30Days: z.number().int() })
  .meta({
    description:
      'Chamadas de ferramentas (`tools/call`) pelo MCP nos últimos 7 e 30 dias, hoje incluído (dias no fuso de São Paulo). Contadores leves: podem ficar um pouco abaixo do real se o cache falhar.',
  })

const WorkspaceIntegrationGrantsDTO = z.object({
  grants: z.array(
    IntegrationGrantDTO.omit({ workspace: true }).extend({
      user: z.object({
        id: z.string(),
        name: z.string(),
        email: z.string(),
        image: z.string().nullable(),
      }),
      usage: McpUsageDTO,
    }),
  ),
  clients: z.array(
    z.object({
      client: IntegrationGrantDTO.shape.client,
      redirectHost: IntegrationGrantDTO.shape.redirectHost.meta({
        description: 'Host da concessão ativa mais recente do app.',
      }),
      members: z
        .number()
        .int()
        .meta({ description: 'Membros com concessão ativa para o app.' }),
      canWrite: z
        .boolean()
        .meta({ description: 'Alguma concessão ativa tem `mcp:write`.' }),
      lastUsedAt: z.string().nullable(),
      usage: McpUsageDTO.meta({
        description:
          'Chamadas de todas as concessões do app no workspace, inclusive as já revogadas.',
      }),
    }),
  ),
})

const RevokeManyDTO = z.object({
  revoked: z.number().int().meta({
    description: 'Concessões revogadas (0 se não havia nenhuma ativa).',
  }),
})

const WORKSPACE_ADMIN_ERRORS: ErrorEntry[] = [
  {
    code: 'FORBIDDEN',
    when: 'Quem chama não é dono nem administrador do workspace',
  },
]

const OAuthConsentResultDTO = z.object({
  redirectUrl: z.string().meta({
    description:
      '`redirect_uri` do cliente, com `code` (aceite) ou `error=access_denied` (recusa). O navegador segue para lá.',
  }),
})

const TOKEN_RESPONSE: JsonSchema = {
  type: 'object',
  properties: {
    access_token: { type: 'string', example: 'stl_at_…' },
    token_type: { type: 'string', example: 'Bearer' },
    expires_in: { type: 'integer', example: 3600 },
    expires_at: { type: 'integer' },
    refresh_token: {
      type: 'string',
      example: 'stl_rt_…',
      description: 'Só quando o escopo `offline_access` foi pedido.',
    },
    scope: { type: 'string', example: 'mcp:read offline_access' },
  },
}

function oauth(
  config: Omit<RouteConfig, 'tags' | 'auth' | 'description'> & {
    description: string
  },
): RouteConfig {
  const { description, ...rest } = config
  return {
    ...rest,
    tags: [TAG],
    auth: 'public',
    rateLimit: 'auth',
    autoErrors: false,
    description: `${description}\n\n${OAUTH_NOTE}`,
  }
}

const routes: RouteConfig[] = [
  oauth({
    method: 'get',
    path: '/auth/oauth2/authorize',
    summary: 'Autorizar (authorization code + PKCE)',
    description:
      'Início do fluxo. Sem sessão, o navegador vai para o login e volta; com sessão, sempre cai na tela de consentimento `/oauth/consent`, onde o usuário escolhe o workspace, os módulos e o nível de acesso. PKCE (`S256`) é obrigatório para clientes públicos.',
    query: {
      type: 'object',
      required: ['client_id', 'redirect_uri', 'response_type'],
      properties: {
        response_type: { type: 'string', enum: ['code'] },
        client_id: { type: 'string' },
        redirect_uri: { type: 'string', format: 'uri' },
        scope: {
          type: 'string',
          example: 'mcp:read mcp:write offline_access',
        },
        state: { type: 'string' },
        code_challenge: { type: 'string' },
        code_challenge_method: { type: 'string', enum: ['S256'] },
        resource: {
          type: 'string',
          format: 'uri',
          example: 'https://app.steel.com.br/api/mcp',
        },
      },
    },
    responses: {
      302: {
        description:
          'Redireciona para o login, para `/oauth/consent` ou, em erro, para o `redirect_uri` com `error`.',
        envelope: false,
      },
    },
  }),
  oauth({
    method: 'post',
    path: '/auth/oauth2/token',
    summary: 'Trocar o código ou renovar o token',
    description:
      '`grant_type=authorization_code` (com `code_verifier`) ou `grant_type=refresh_token`. O access token é opaco (prefixo `stl_at_`) e vale 1 hora; cada chamada ao MCP o resolve para a concessão (`IntegrationGrant`), então revogar ou remover o membro corta o acesso na chamada seguinte.',
    body: {
      contentType: 'application/x-www-form-urlencoded',
      schema: {
        type: 'object',
        required: ['grant_type', 'client_id'],
        properties: {
          grant_type: {
            type: 'string',
            enum: ['authorization_code', 'refresh_token'],
          },
          client_id: { type: 'string' },
          code: { type: 'string' },
          code_verifier: { type: 'string' },
          redirect_uri: { type: 'string', format: 'uri' },
          refresh_token: { type: 'string' },
          resource: { type: 'string', format: 'uri' },
        },
      },
    },
    responses: {
      200: { description: 'Tokens.', envelope: false, schema: TOKEN_RESPONSE },
      400: {
        description: '`invalid_grant`, `invalid_request`, `invalid_client`…',
        envelope: false,
      },
    },
  }),
  oauth({
    method: 'post',
    path: '/auth/oauth2/register',
    summary: 'Registro dinâmico de cliente (RFC 7591)',
    description:
      'Clientes MCP se registram sozinhos, sem autenticação. Registrar não dá acesso a nada: quem decide é o usuário, no consentimento.',
    body: {
      schema: {
        type: 'object',
        required: ['redirect_uris'],
        properties: {
          client_name: { type: 'string', example: 'Claude' },
          redirect_uris: {
            type: 'array',
            items: { type: 'string', format: 'uri' },
          },
          token_endpoint_auth_method: { type: 'string', enum: ['none'] },
          grant_types: {
            type: 'array',
            items: {
              type: 'string',
              enum: ['authorization_code', 'refresh_token'],
            },
          },
          scope: { type: 'string', example: 'mcp:read mcp:write' },
        },
      },
    },
    responses: {
      201: {
        description: 'Cliente registrado (`client_id`, metadados).',
        envelope: false,
      },
    },
  }),
  oauth({
    method: 'post',
    path: '/auth/oauth2/revoke',
    summary: 'Revogar um token (RFC 7009)',
    description:
      'Revoga o access ou o refresh token informado. Para revogar a concessão inteira (todos os tokens do app no workspace), use `DELETE /users/me/integration-grants/{id}`.',
    body: {
      contentType: 'application/x-www-form-urlencoded',
      schema: {
        type: 'object',
        required: ['token'],
        properties: {
          token: { type: 'string' },
          token_type_hint: {
            type: 'string',
            enum: ['access_token', 'refresh_token'],
          },
          client_id: { type: 'string' },
        },
      },
    },
    responses: {
      200: { description: 'Token revogado (ou já inválido).', envelope: false },
    },
  }),
  {
    method: 'post',
    path: '/oauth/consent',
    tags: [TAG],
    summary: 'Responder ao consentimento',
    description:
      'Chamado pela tela `/oauth/consent`. `oauthQuery` é a query assinada com que o provedor redirecionou para a tela (a assinatura e a validade de 10 minutos são conferidas pelo provedor). No aceite, o usuário precisa ser membro do workspace, os módulos precisam estar habilitados nele e os escopos precisam ter sido pedidos pelo app; a concessão é criada (ou atualizada, se já existia para o mesmo app e workspace) e o código de autorização sai preso a ela.',
    consent: true,
    body: OAuthConsentSchema,
    responses: {
      200: {
        description: 'Para onde o navegador segue.',
        schema: OAuthConsentResultDTO,
      },
    },
    errors: [
      {
        code: 'OAUTH_REQUEST_INVALID',
        when: 'Query ausente, adulterada ou expirada; app desconhecido ou desativado',
      },
      { code: 'FORBIDDEN', when: 'O usuário não é membro do workspace' },
      {
        code: 'MODULE_DISABLED',
        when: 'Algum módulo escolhido não está habilitado no workspace',
      },
    ],
  },
  {
    method: 'get',
    path: '/users/me/integration-grants',
    tags: [TAG],
    summary: 'Listar apps conectados',
    description:
      'Concessões ativas do usuário da sessão: o app (cliente OAuth), o workspace, os escopos, os módulos e o último uso.',
    responses: {
      200: {
        description: 'Concessões ativas, mais recentes primeiro.',
        schema: z.array(IntegrationGrantDTO),
      },
    },
  },
  {
    method: 'delete',
    path: '/users/me/integration-grants/{id}',
    tags: [TAG],
    summary: 'Revogar um app conectado',
    description:
      'Revoga a concessão, apaga os access tokens, revoga os refresh tokens e remove o consentimento. A próxima chamada do app ao MCP responde 401, e conectar de novo pede o consentimento outra vez.',
    params: { id: 'ID da concessão.' },
    responses: {
      200: {
        description: 'Concessão revogada.',
        schema: z.object({ id: z.string() }),
      },
    },
    errors: [
      {
        code: 'INTEGRATION_GRANT_NOT_FOUND',
        when: 'Concessão inexistente, já revogada ou de outro usuário',
      },
    ],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/integration-grants',
    tags: [TAG],
    summary: 'Listar apps conectados do workspace',
    description:
      'Só dono e administradores. Todas as concessões ativas dos membros do workspace (quem autorizou, o app, escopos, módulos, último uso e chamadas recentes) e um resumo por app.',
    params: { id: 'ID do workspace.' },
    responses: {
      200: {
        description: 'Concessões ativas (mais recentes primeiro) e apps.',
        schema: WorkspaceIntegrationGrantsDTO,
      },
    },
    errors: WORKSPACE_ADMIN_ERRORS,
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/integration-grants/{grantId}',
    tags: [TAG],
    summary: 'Revogar a concessão de um membro',
    description:
      'Só dono e administradores. Revoga a concessão, apaga os access tokens, revoga os refresh tokens e remove o consentimento; a próxima chamada do app ao MCP responde 401.',
    params: { id: 'ID do workspace.', grantId: 'ID da concessão.' },
    responses: {
      200: {
        description: 'Concessão revogada.',
        schema: z.object({ id: z.string() }),
      },
    },
    errors: [
      ...WORKSPACE_ADMIN_ERRORS,
      {
        code: 'INTEGRATION_GRANT_NOT_FOUND',
        when: 'Concessão inexistente, já revogada ou de outro workspace',
      },
    ],
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/integration-grants/members/{userId}',
    tags: [TAG],
    summary: 'Revogar todos os apps de um membro',
    description:
      'Só dono e administradores. Revoga, numa transação, todas as concessões ativas do membro no workspace, de qualquer app.',
    params: { id: 'ID do workspace.', userId: 'ID do usuário.' },
    responses: {
      200: { description: 'Quantas foram revogadas.', schema: RevokeManyDTO },
    },
    errors: WORKSPACE_ADMIN_ERRORS,
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/integration-grants/clients/{clientId}',
    tags: [TAG],
    summary: 'Revogar um app de todos os membros',
    description:
      'Só dono e administradores. Revoga, numa transação, as concessões ativas de todos os membros para o app (cliente OAuth) no workspace. O app ainda pode pedir um novo consentimento.',
    params: { id: 'ID do workspace.', clientId: '`client_id` do app.' },
    responses: {
      200: { description: 'Quantas foram revogadas.', schema: RevokeManyDTO },
    },
    errors: WORKSPACE_ADMIN_ERRORS,
  },
]

export function registerIntegrationGrantPaths(registry: OpenApiRegistry): void {
  for (const route of routes) registry.registerRoute(route)
}
