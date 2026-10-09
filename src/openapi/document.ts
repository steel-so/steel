import { errorCodeSchema } from './errors'
import type { JsonSchema } from './json-schema'
import { registerAdminPaths } from './paths/admin'
import { registerAuthPaths } from './paths/auth'
import { registerCorePaths } from './paths/core'
import { registerCrmPaths } from './paths/crm'
import { registerIntegrationPaths } from './paths/integrations'
import { registerPublicPaths } from './paths/public'
import { registerSearchPaths } from './paths/search'
import { registerServiceDeskPaths } from './paths/servicedesk'
import { registerServiceDeskKnowledgePaths } from './paths/servicedesk-knowledge'
import { registerSdTicketPaths } from './paths/servicedesk-tickets'
import { registerSettingsExportsWorklogsPaths } from './paths/settings-exports-worklogs'
import { registerSteelAgentsPaths } from './paths/steel-agents'
import { registerSteelAiPaths } from './paths/steel-ai'
import { registerSteelAiSkillsPaths } from './paths/steel-ai-skills'
import { registerSteelAiTemplatesPaths } from './paths/steel-ai-templates'
import { registerSteelAiUsagePaths } from './paths/steel-ai-usage'
import { registerWhatsAppPaths } from './paths/whatsapp'
import { registerWhiteboardPaths } from './paths/whiteboard'
import { registerWikiPaths } from './paths/wiki'
import { OpenApiRegistry } from './registry'
import { TAG_GROUPS } from './tags'

/** Registra todas as operações documentadas, domínio a domínio. */
export function createRegistry(): OpenApiRegistry {
  const registry = new OpenApiRegistry()
  registerAuthPaths(registry)
  registerCorePaths(registry)
  registerAdminPaths(registry)
  registerPublicPaths(registry)
  registerCrmPaths(registry)
  registerWhatsAppPaths(registry)
  registerServiceDeskKnowledgePaths(registry)
  registerServiceDeskPaths(registry)
  registerSdTicketPaths(registry)
  registerSteelAiPaths(registry)
  registerSteelAiUsagePaths(registry)
  registerSteelAiSkillsPaths(registry)
  registerSteelAiTemplatesPaths(registry)
  registerSteelAgentsPaths(registry)
  registerSearchPaths(registry)
  registerWikiPaths(registry)
  registerWhiteboardPaths(registry)
  registerSettingsExportsWorklogsPaths(registry)
  registerIntegrationPaths(registry)
  return registry
}

const INFO_DESCRIPTION = `API do **Steel**, a plataforma multi-tenant da Stratus Telecom que reúne ServiceDesk, CRM e Comunicação (WhatsApp Business) num mesmo workspace.

## Autenticação

- **Sessão (cookie)** — quase todas as rotas usam o cookie \`better-auth.session_token\` (\`__Secure-better-auth.session_token\` em HTTPS), emitido pelo login em \`/auth/sign-in/email\`. Rotas sem sessão retornam \`401 UNAUTHORIZED\` (para \`/api/*\` o proxy responde 401 antes mesmo da rota).
- **Chave de API de integração** — a entrada de leads (\`POST /crm/integrations/leads\`) usa \`Authorization: Bearer crm_live_...\`, gerada no menu lateral do CRM, em **Chaves de API**.
- **Tokens no path** — formulários, propostas, landing pages, workflows por webhook e descadastro são públicos: o token opaco no path é o acesso.
- **Webhooks** — AbacatePay (\`x-webhook-secret\`), Meta (\`X-Hub-Signature-256\`) e Z-API (\`?secret=\`).

## Envelope de resposta

Toda rota do Steel responde no envelope padrão (\`types/http-response.d.ts\`):

- sucesso: \`{ "success": true, "statusCode": 200, "data": ... }\`
- erro: \`{ "success": false, "statusCode": 404, "message": "...", "error": { "code": "CRM_FORM_NOT_FOUND", "details": ... } }\`

Exceções, marcadas em cada rota: \`/auth/*\` (payloads do Better Auth), downloads binários e redirects. Trate erros pelo \`error.code\` (lista completa no schema \`ErrorCode\`), nunca pela mensagem. Falhas inesperadas respondem \`500\` com \`DATABASE_ERROR\` ou \`INTERNAL_SERVER_ERROR\`.

## Multi-tenancy

Rotas \`/workspaces/{id}/...\` exigem que o usuário seja membro do workspace (\`403 FORBIDDEN\` caso contrário) e que o workspace não esteja suspenso (\`403 WORKSPACE_SUSPENDED\`). Rotas dos módulos também exigem o módulo habilitado (\`403 MODULE_DISABLED\`).

## Versão

CalVer (\`YYYY.MM.DD[.N]\`, ADR 0003): \`info.version\` é a última release sincronizada. Este arquivo é **gerado** por \`pnpm openapi:generate\` a partir de \`src/openapi/\` — não edite \`public/openapi.json\` à mão (ver \`docs/api.md\`).`

const SECURITY_SCHEMES: Record<string, JsonSchema> = {
  cookieAuth: {
    type: 'apiKey',
    in: 'cookie',
    name: 'better-auth.session_token',
    description:
      'Cookie de sessão HttpOnly do Better Auth, definido no login. Em HTTPS o nome ganha o prefixo `__Secure-`.',
  },
  crmIntegrationKey: {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'crm_live_<token>',
    description:
      'Chave de API de integração do CRM (`Authorization: Bearer crm_live_...`). Criada por OWNER/ADMIN no menu lateral do CRM, em Chaves de API; o valor completo só é exibido na criação. Chaves revogadas respondem `401 CRM_INTEGRATION_KEY_INVALID`.',
  },
  abacatePayWebhookSecret: {
    type: 'apiKey',
    in: 'header',
    name: 'x-webhook-secret',
    description:
      'Segredo compartilhado com a AbacatePay, comparado em tempo constante.',
  },
  statusCollectorSecret: {
    type: 'apiKey',
    in: 'header',
    name: 'x-status-secret',
    description:
      'Segredo do coletor interno da página de status (cron), comparado em tempo constante.',
  },
  metaWebhookSignature: {
    type: 'apiKey',
    in: 'header',
    name: 'X-Hub-Signature-256',
    description:
      'Assinatura HMAC-SHA256 do corpo bruto com o App Secret da Meta (`sha256=<hex>`).',
  },
  zapiWebhookSecret: {
    type: 'apiKey',
    in: 'query',
    name: 'secret',
    description:
      'Segredo por conexão Z-API, incluído na URL de webhook cadastrada na Z-API.',
  },
}

const SUCCESS_ENVELOPE: JsonSchema = {
  type: 'object',
  description: 'Envelope padrão de sucesso (`successResponse`).',
  required: ['success', 'statusCode', 'data'],
  properties: {
    success: { type: 'boolean', const: true },
    statusCode: { type: 'integer', example: 200 },
    message: { type: 'string', description: 'Mensagem opcional.' },
    data: { description: 'Payload da operação.' },
  },
}

const ERROR_RESPONSE: JsonSchema = {
  type: 'object',
  description: 'Envelope padrão de erro (`handleError` / `standardError`).',
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
            'Detalhes opcionais. Em `VALIDATION_ERROR`, a lista de issues do Zod (`code`, `path`, `message`); em `RATE_LIMITED`, `{ retryAfterSeconds }`.',
        },
      },
    },
  },
}

export interface BuildOptions {
  /** Tag CalVer literal (`2026.08.31`). */
  version: string
}

/** Monta o documento OpenAPI 3.1 completo, determinístico. */
export function buildOpenApiDocument({ version }: BuildOptions): JsonSchema {
  const registry = createRegistry()
  registry.addSchema('SuccessEnvelope', SUCCESS_ENVELOPE)
  registry.addSchema('ErrorResponse', ERROR_RESPONSE)
  registry.addSchema('ErrorCode', errorCodeSchema())

  const { paths, schemas, responses, usedTags } = registry.build()

  const tags: JsonSchema[] = []
  const tagGroups: JsonSchema[] = []
  for (const group of TAG_GROUPS) {
    const groupTags = group.tags.filter((tag) => usedTags.has(tag.name))
    if (groupTags.length === 0) continue
    tags.push(...groupTags.map((tag) => ({ ...tag })))
    tagGroups.push({ name: group.name, tags: groupTags.map((tag) => tag.name) })
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'Steel API',
      version,
      description: INFO_DESCRIPTION,
      contact: {
        name: 'Stratus Telecom',
        email: 'suporte@stratustelecom.com.br',
      },
    },
    servers: [
      {
        url: 'http://localhost:3001/api',
        description: 'Desenvolvimento local',
      },
      {
        url: 'https://homologacao.stratustelecom.com.br/api',
        description: 'Homologação',
      },
    ],
    tags,
    'x-tagGroups': tagGroups,
    security: [{ cookieAuth: [] }],
    paths,
    components: {
      securitySchemes: SECURITY_SCHEMES,
      parameters: {
        WorkspaceId: {
          name: 'id',
          in: 'path',
          required: true,
          description: 'ID do workspace (cuid2).',
          schema: { type: 'string' },
          example: 'ckv9x2p0h0000ws7d3k1e5abc',
        },
      },
      responses,
      schemas,
    },
  }
}

const INLINE_ARRAY_MAX = 80

/**
 * Serialização estável: JSON com 2 espaços, mas arrays curtos de valores
 * primitivos (`tags`, `required`, `enum`...) numa linha só — mantém o
 * arquivo legível e o diff pequeno. Mesma entrada → mesma saída.
 */
export function serializeOpenApiDocument(document: JsonSchema): string {
  const format = (value: unknown, indent: string): string => {
    if (Array.isArray(value)) {
      if (value.length === 0) return '[]'
      const inline = JSON.stringify(value)
      if (
        value.every((item) => item === null || typeof item !== 'object') &&
        inline.length <= INLINE_ARRAY_MAX
      ) {
        return inline.replace(/,/g, ', ')
      }
      const inner = `${indent}  `
      return `[\n${value.map((item) => inner + format(item, inner)).join(',\n')}\n${indent}]`
    }
    if (value !== null && typeof value === 'object') {
      const entries = Object.entries(value).filter(
        ([, item]) => item !== undefined,
      )
      if (entries.length === 0) return '{}'
      const inner = `${indent}  `
      return `{\n${entries
        .map(
          ([key, item]) =>
            `${inner}${JSON.stringify(key)}: ${format(item, inner)}`,
        )
        .join(',\n')}\n${indent}}`
    }
    return JSON.stringify(value)
  }
  return `${format(document, '')}\n`
}
