import type { ErrorCode } from '@/src/errors/codes'
import { ERROR_CODE_LIST, statusOf } from '../errors'
import type { JsonSchema } from '../json-schema'
import { registerV1WebhookPaths } from '../paths/webhooks'
import { compareStrings, OpenApiRegistry } from '../registry'
import { TAG_GROUPS } from '../tags'
import { registerV1AccountPaths } from './paths/account'
import { registerV1AuthPaths } from './paths/auth'
import { registerV1CrmPaths } from './paths/crm'
import { registerV1ServiceDeskPaths } from './paths/servicedesk'
import { registerV1WhatsAppPaths } from './paths/whatsapp'

/**
 * The public API v1 document (`public/openapi.v1.json`, ADR 0035): only the
 * `/api/v1` routes. They are registered relative to `/api/v1` and written
 * with the full `/api/v1/...` path (servers are the bare hosts), the shape
 * the CLI's SDK is generated from. Separate from the app's
 * `openapi.json` because this one is a stable contract — the CI compares
 * it with the previous commit and fails on breaking changes
 * (`scripts/check-openapi-v1-compat.ts`).
 *
 * Other v1 slices (device flow, outbound webhooks) append their register
 * function here.
 */
export function createV1Registry(): OpenApiRegistry {
  const registry = new OpenApiRegistry()
  registerV1AuthPaths(registry)
  registerV1AccountPaths(registry)
  registerV1ServiceDeskPaths(registry)
  registerV1CrmPaths(registry)
  registerV1WhatsAppPaths(registry)
  registerV1WebhookPaths(registry)
  return registry
}

/** Prefix of every path in the document (the routes live in `app/api/v1`). */
export const V1_BASE_PATH = '/api/v1'

/** Rewrites the registry's `ErrorResponse` refs to `ErrorEnvelope`. */
function renameErrorEnvelope<T>(built: T): T {
  return JSON.parse(
    JSON.stringify(built).replaceAll(
      '"#/components/schemas/ErrorResponse"',
      '"#/components/schemas/ErrorEnvelope"',
    ),
  ) as T
}

/** Tags of the v1 group in `tags.ts`, shown without the `v1 · ` prefix. */
export const V1_TAG_GROUP = 'API pública v1'
const V1_TAG_PREFIX = 'v1 · '

const stripPrefix = (tag: string) =>
  tag.startsWith(V1_TAG_PREFIX) ? tag.slice(V1_TAG_PREFIX.length) : tag

const INFO_DESCRIPTION = `API pública e estável do **Steel** para integrações, scripts, CI e o \`steel\` CLI.

## Autenticação

Toda rota exige um **token pessoal** no cabeçalho \`Authorization: Bearer stl_pat_...\`. O cookie de sessão do app não vale aqui. Crie o token em **Configurações › Segurança › Tokens de API** (ou com \`steel login\`), escolhendo o workspace, os módulos e o escopo:

- \`api:read\` — leitura;
- \`api:write\` — leitura e escrita (sem ele, escritas respondem \`403 API_TOKEN_SCOPE_REQUIRED\`).

A chamada roda com as permissões do dono do token no workspace do token: o papel e as permissões do perfil valem como no app. Rota de um módulo fora do token responde \`403 API_TOKEN_MODULE_NOT_ALLOWED\`. Token vencido, revogado ou de quem saiu do workspace responde \`401 UNAUTHORIZED\`.

## Envelope e erros

Igual ao resto do Steel: \`{ "success": true, "statusCode": 200, "data": ... }\` e, no erro, \`{ "success": false, "statusCode": 404, "message": "...", "error": { "code": "...", "details": ... } }\`. Trate pelo \`error.code\`.

## Paginação

Listas usam cursor: \`?limit=\` (padrão 25, máximo 100) e \`?cursor=\`. A resposta traz \`data.items\` e \`data.nextCursor\` (\`null\` na última página). O cursor é opaco.

## Limites

Por token, 300 requisições por minuto, além do limite do usuário (o mesmo do app, 100 por minuto). Ao estourar: \`429 RATE_LIMITED\` com \`Retry-After\`.

## Estabilidade

Nada sai e nada muda de tipo nesta versão: campos e rotas novos podem entrar a qualquer momento (ignore o que não conhece). Uma rota só é removida depois de 6 meses com os cabeçalhos \`Deprecation\` e \`Sunset\` e aviso no changelog de desenvolvedores.`

const SUCCESS_ENVELOPE: JsonSchema = {
  type: 'object',
  required: ['success', 'statusCode', 'data'],
  properties: {
    success: { type: 'boolean', const: true },
    statusCode: { type: 'integer', example: 200 },
    message: { type: 'string' },
    data: { description: 'Payload da operação.' },
  },
}

const ERROR_RESPONSE: JsonSchema = {
  type: 'object',
  required: ['success', 'statusCode', 'error'],
  properties: {
    success: { type: 'boolean', const: false },
    statusCode: { type: 'integer', example: 404 },
    message: {
      type: 'string',
      description: 'Mensagem legível (pt-BR); pode mudar sem aviso.',
    },
    error: {
      type: 'object',
      required: ['code'],
      properties: {
        code: { $ref: '#/components/schemas/ErrorCode' },
        details: {
          description:
            'Em `VALIDATION_ERROR`, as issues do Zod (`code`, `path`, `message`); em `RATE_LIMITED`, `{ retryAfterSeconds }`.',
        },
      },
    },
  },
}

/** Codes any v1 call can answer, documented or not on the route. */
const ALWAYS_POSSIBLE: ErrorCode[] = [
  'UNAUTHORIZED',
  'FORBIDDEN',
  'VALIDATION_ERROR',
  'RATE_LIMITED',
  'INTERNAL_SERVER_ERROR',
  'DATABASE_ERROR',
]

/**
 * `ErrorCode` of the v1 document: only the codes its routes document (the
 * app's full list would change the stable document on every new feature).
 */
function v1ErrorCodeSchema(responses: Record<string, JsonSchema>): JsonSchema {
  const used = new Set<string>(ALWAYS_POSSIBLE)
  for (const response of Object.values(responses)) {
    const content = response.content as
      | Record<string, { examples?: Record<string, { value?: JsonSchema }> }>
      | undefined
    for (const media of Object.values(content ?? {})) {
      for (const example of Object.values(media.examples ?? {})) {
        const code = (example.value?.error as { code?: string } | undefined)
          ?.code
        if (code) used.add(code)
      }
    }
  }
  const codes = ERROR_CODE_LIST.filter((code) => used.has(code))
  return {
    type: 'string',
    enum: codes,
    description: [
      'Código estável do erro. Use o código — não a mensagem — para tratar erros no cliente. Códigos novos podem aparecer.',
      '',
      '| Código | Status HTTP |',
      '| ------ | ----------- |',
      ...codes.map((code) => `| \`${code}\` | ${statusOf(code)} |`),
    ].join('\n'),
  }
}

/** The whole v1 document, deterministic. */
export function buildOpenApiV1Document({
  version,
}: {
  version: string
}): JsonSchema {
  const registry = createV1Registry()
  registry.addSchema('SuccessEnvelope', SUCCESS_ENVELOPE)
  // `ErrorEnvelope` in this document (the SDK's type name); the registry
  // points error responses at `ErrorResponse`, renamed below.
  registry.addSchema('ErrorResponse', ERROR_RESPONSE)

  const { usedTags, ...raw } = registry.build()
  const built = renameErrorEnvelope(raw)
  const { responses } = built
  const { ErrorResponse, ...otherSchemas } = built.schemas
  const schemas = Object.fromEntries(
    Object.entries({
      ...otherSchemas,
      ErrorEnvelope: ErrorResponse,
      ErrorCode: v1ErrorCodeSchema(responses),
    }).sort(([a], [b]) => compareStrings(a, b)),
  )

  const paths: Record<string, Record<string, JsonSchema>> = {}
  for (const [path, item] of Object.entries(built.paths)) {
    for (const operation of Object.values(item)) {
      operation.tags = (operation.tags as string[]).map(stripPrefix)
    }
    paths[`${V1_BASE_PATH}${path}`] = item
  }

  const group = TAG_GROUPS.find((item) => item.name === V1_TAG_GROUP)
  const tags = (group?.tags ?? [])
    .filter((tag) => usedTags.has(tag.name))
    .map((tag) => ({
      name: stripPrefix(tag.name),
      description: tag.description,
    }))

  return {
    openapi: '3.1.0',
    info: {
      title: 'Steel API v1',
      version,
      description: INFO_DESCRIPTION,
      contact: {
        name: 'Stratus Telecom',
        email: 'suporte@stratustelecom.com.br',
      },
    },
    servers: [
      {
        url: 'https://homologacao.stratustelecom.com.br',
        description: 'Homologação',
      },
      { url: 'http://localhost:3001', description: 'Desenvolvimento local' },
    ],
    tags,
    security: [{ personalToken: [] }],
    paths,
    components: {
      securitySchemes: {
        personalToken: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'stl_pat_<token>',
          description:
            'Token pessoal do Steel (`Authorization: Bearer stl_pat_...`), criado em Configurações › Segurança › Tokens de API ou com `steel login`. O valor só aparece na criação.',
        },
      },
      responses,
      schemas,
    },
  }
}
