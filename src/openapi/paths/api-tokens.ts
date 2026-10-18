import { z } from 'zod'
import { API_SCOPES } from '@/src/lib/api/session'
import {
  ApiModuleSchema,
  CreateApiTokenSchema,
  DeviceAuthorizationStartSchema,
  DeviceAuthorizeSchema,
  DeviceTokenPollSchema,
} from '@/src/schemas/api-token.schema'
import type { ErrorEntry, OpenApiRegistry, RouteConfig } from '../registry'

/**
 * Personal API tokens and the CLI device flow (ADR 0035, docs/cli/README.md).
 */

const TAG = 'Tokens de API' as const

const ApiTokenFields = {
  id: z.string(),
  name: z.string(),
  prefix: z.string().meta({
    description:
      'Começo do token (`stl_pat_` + 8 caracteres), para reconhecer.',
    example: 'stl_pat_Xk3v9QaB',
  }),
  scopes: z.array(z.enum(API_SCOPES)),
  modules: z.array(ApiModuleSchema),
  createdVia: z.enum(['SETTINGS', 'DEVICE']).meta({
    description:
      '`SETTINGS` (Configurações › Segurança) ou `DEVICE` (`steel login`).',
  }),
  deviceName: z.string().nullable(),
  expiresAt: z.string(),
  expired: z.boolean().meta({
    description:
      'Já venceu: segue na lista até ser revogado, mas não funciona.',
  }),
  lastUsedAt: z
    .string()
    .nullable()
    .meta({ description: 'Atualizado no máximo uma vez por minuto.' }),
  createdAt: z.string(),
}

const ApiTokenDTO = z.object({
  ...ApiTokenFields,
  workspace: z.object({ id: z.string(), name: z.string(), slug: z.string() }),
})

const ApiTokenCreatedDTO = ApiTokenDTO.extend({
  token: z.string().meta({
    description: 'O valor do token. Só aparece nesta resposta; guarde-o agora.',
    example: 'stl_pat_Xk3v9QaB…',
  }),
})

const WorkspaceApiTokenDTO = z.object({
  ...ApiTokenFields,
  user: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    image: z.string().nullable(),
  }),
})

const DeviceAuthorizationDTO = z.object({
  deviceCode: z.string().meta({
    description: 'Segredo do CLI para consultar `/v1/auth/device/token`.',
  }),
  userCode: z.string().meta({ example: 'BCDF-GH23' }),
  verificationUri: z
    .string()
    .meta({ example: 'https://app.steel.com.br/device' }),
  verificationUriComplete: z
    .string()
    .meta({ example: 'https://app.steel.com.br/device?code=BCDF-GH23' }),
  interval: z
    .number()
    .int()
    .meta({ description: 'Segundos entre consultas.', example: 5 }),
  expiresIn: z
    .number()
    .int()
    .meta({ description: 'Segundos até o código expirar.', example: 600 }),
})

const DeviceTokenDTO = z.object({
  token: z.string().meta({ example: 'stl_pat_…' }),
  tokenId: z.string(),
  expiresAt: z.string(),
  workspace: z.object({ id: z.string(), slug: z.string(), name: z.string() }),
  scopes: z.array(z.enum(API_SCOPES)),
  modules: z.array(ApiModuleSchema),
})

const IdDTO = z.object({ id: z.string() })

const WORKSPACE_ADMIN_ERRORS: ErrorEntry[] = [
  {
    code: 'FORBIDDEN',
    when: 'Quem chama não é dono nem administrador do workspace',
  },
]

const ISSUE_ERRORS: ErrorEntry[] = [
  { code: 'FORBIDDEN', when: 'O usuário não é membro do workspace' },
  {
    code: 'MODULE_DISABLED',
    when: 'Algum módulo escolhido não está habilitado no workspace',
  },
  {
    code: 'API_TOKEN_LIMIT_REACHED',
    when: 'O usuário já tem 50 tokens ativos',
  },
]

const routes: RouteConfig[] = [
  {
    method: 'post',
    path: '/v1/auth/device',
    tags: [TAG],
    summary: 'Iniciar o login do CLI (fluxo de dispositivo)',
    description:
      'Usado por `steel login`. Cria um login pendente e devolve o código do dispositivo (para o CLI consultar) e o código do usuário (para confirmar em `/device`). Sem sessão nem token; o código vale 10 minutos.',
    auth: 'public',
    rateLimit: 'ip',
    body: DeviceAuthorizationStartSchema,
    // `clientName` (ex.: `steel-cli/1.2.0`) só vai para a auditoria.
    responses: {
      200: { description: 'Login pendente.', schema: DeviceAuthorizationDTO },
    },
  },
  {
    method: 'post',
    path: '/v1/auth/device/token',
    tags: [TAG],
    summary: 'Consultar o login do CLI',
    description:
      'O CLI consulta a cada `interval` segundos até o usuário responder em `/device`. Aprovado, a resposta traz o token pessoal (uma vez só) com o workspace, os escopos e os módulos escolhidos; o token se chama "Steel CLI — <máquina>".',
    auth: 'public',
    rateLimit: 'ip',
    body: DeviceTokenPollSchema,
    responses: {
      200: { description: 'Login aprovado: o token.', schema: DeviceTokenDTO },
    },
    errors: [
      { code: 'AUTHORIZATION_PENDING', when: 'O usuário ainda não respondeu' },
      {
        code: 'SLOW_DOWN',
        when: 'Consulta antes do intervalo; `details.interval` traz o novo intervalo',
      },
      {
        code: 'EXPIRED_TOKEN',
        when: 'Código expirado, desconhecido ou já usado',
      },
      { code: 'ACCESS_DENIED', when: 'O usuário recusou o login' },
      ...ISSUE_ERRORS,
    ],
  },
  {
    method: 'delete',
    path: '/v1/auth/token',
    tags: [TAG],
    summary: 'Revogar o token da chamada (logout do CLI)',
    description:
      'Usado por `steel logout`. Autenticado pelo próprio token pessoal (`Authorization: Bearer stl_pat_...`; o cookie de sessão não vale) e o revoga: as chamadas seguintes com ele respondem 401. Rate limit por token.',
    auth: 'public',
    rateLimit: false,
    responses: {
      204: { description: 'Token revogado; sem corpo.', envelope: false },
    },
    errors: [
      {
        code: 'UNAUTHORIZED',
        when: 'Token ausente, inválido, vencido ou já revogado',
      },
      {
        code: 'RATE_LIMITED',
        when: 'Mais de 300 chamadas por minuto com o token',
      },
    ],
  },
  {
    method: 'post',
    path: '/device/authorize',
    tags: [TAG],
    summary: 'Responder ao login do CLI',
    description:
      'Chamado pela página `/device`. No aceite, o usuário precisa ser membro do workspace e os módulos precisam estar habilitados nele; o token é emitido na próxima consulta do CLI. Limitado por usuário.',
    body: DeviceAuthorizeSchema,
    responses: {
      200: {
        description: 'Resposta registrada.',
        schema: z.object({ status: z.enum(['approved', 'denied']) }),
      },
    },
    errors: [
      {
        code: 'DEVICE_CODE_INVALID',
        when: 'Código desconhecido, expirado ou já respondido',
      },
      ...ISSUE_ERRORS,
    ],
  },
  {
    method: 'get',
    path: '/users/me/api-tokens',
    tags: [TAG],
    summary: 'Listar tokens de API',
    description:
      'Tokens não revogados do usuário da sessão (os vencidos aparecem com `expired: true`). O valor nunca volta aqui.',
    responses: {
      200: {
        description: 'Tokens, mais recentes primeiro.',
        schema: z.array(ApiTokenDTO),
      },
    },
  },
  {
    method: 'post',
    path: '/users/me/api-tokens',
    tags: [TAG],
    summary: 'Criar token de API',
    description:
      'Cria um token pessoal (`stl_pat_...`) para a API v1, preso a um workspace, com escopos (`api:read` obrigatório, `api:write` opcional), módulos e validade (padrão 90 dias, máximo 365). O valor só aparece nesta resposta.',
    body: CreateApiTokenSchema,
    responses: {
      201: {
        description: 'Token criado, com o valor.',
        schema: ApiTokenCreatedDTO,
      },
    },
    errors: ISSUE_ERRORS,
  },
  {
    method: 'get',
    path: '/users/me/api-tokens/workspaces',
    tags: [TAG],
    summary: 'Workspaces para um novo token',
    description:
      'Workspaces ativos do usuário com ao menos um módulo habilitado, e esses módulos: as opções do formulário de criação.',
    responses: {
      200: {
        description: 'Workspaces e módulos.',
        schema: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            slug: z.string(),
            modules: z.array(ApiModuleSchema),
          }),
        ),
      },
    },
  },
  {
    method: 'delete',
    path: '/users/me/api-tokens/{id}',
    tags: [TAG],
    summary: 'Revogar token de API',
    description: 'A próxima chamada à API v1 com o token responde 401.',
    params: { id: 'ID do token.' },
    responses: { 200: { description: 'Token revogado.', schema: IdDTO } },
    errors: [
      {
        code: 'API_TOKEN_NOT_FOUND',
        when: 'Token inexistente, já revogado ou de outro usuário',
      },
    ],
  },
  {
    method: 'get',
    path: '/workspaces/{id}/api-tokens',
    tags: [TAG],
    summary: 'Listar tokens de API do workspace',
    description:
      'Só dono e administradores. Tokens não revogados de todos os membros, com quem os criou.',
    params: { id: 'ID do workspace.' },
    responses: {
      200: {
        description: 'Tokens, mais recentes primeiro.',
        schema: z.array(WorkspaceApiTokenDTO),
      },
    },
    errors: WORKSPACE_ADMIN_ERRORS,
  },
  {
    method: 'delete',
    path: '/workspaces/{id}/api-tokens/{tokenId}',
    tags: [TAG],
    summary: 'Revogar token de um membro',
    description:
      'Só dono e administradores. A próxima chamada à API v1 com o token responde 401.',
    params: { id: 'ID do workspace.', tokenId: 'ID do token.' },
    responses: { 200: { description: 'Token revogado.', schema: IdDTO } },
    errors: [
      ...WORKSPACE_ADMIN_ERRORS,
      {
        code: 'API_TOKEN_NOT_FOUND',
        when: 'Token inexistente, já revogado ou de outro workspace',
      },
    ],
  },
]

export function registerApiTokenPaths(registry: OpenApiRegistry): void {
  for (const route of routes) registry.registerRoute(route)
}
