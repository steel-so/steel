import type { z } from 'zod'
import { ERROR_CODES, type ErrorCode } from '@/src/errors/codes'
import {
  defaultMessage,
  ERROR_CODE_LIST,
  errorExample,
  STATUS_TITLES,
  statusOf,
} from './errors'
import {
  isZodSchema,
  type JsonSchema,
  type SchemaIo,
  schemaId,
  zodToJsonSchema,
} from './json-schema'
import type { TagName } from './tags'

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'head'

export const HTTP_METHODS: readonly HttpMethod[] = [
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'head',
]

/* ------------------------------------------------------------------ */
/* Componentes nomeados                                                 */
/* ------------------------------------------------------------------ */

const COMPONENT_MARK = '__openapiComponent'

/** Referência a um schema nomeado em `components.schemas`. */
export interface ComponentRef {
  readonly [COMPONENT_MARK]: true
  readonly name: string
  readonly source: z.ZodType | JsonSchema
  readonly io: SchemaIo
}

/**
 * Declara um schema nomeado (vira `#/components/schemas/<name>`). Aceita um
 * schema Zod (convertido com `z.toJSONSchema`) ou JSON Schema cru — útil
 * para DTOs de resposta que só existem como `interface` em `types/`.
 */
export function component(
  name: string,
  source: z.ZodType | JsonSchema,
  io: SchemaIo = 'output',
): ComponentRef {
  return { [COMPONENT_MARK]: true, name, source, io }
}

function isComponentRef(value: unknown): value is ComponentRef {
  return typeof value === 'object' && value !== null && COMPONENT_MARK in value
}

/** Zod, componente nomeado ou JSON Schema cru. */
export type SchemaSource = z.ZodType | ComponentRef | JsonSchema

/* ------------------------------------------------------------------ */
/* Configuração de rota                                                 */
/* ------------------------------------------------------------------ */

/**
 * Como a rota autentica:
 * - `session`: cookie de sessão do Better Auth (padrão).
 * - `public`: sem autenticação (ou o token vai no path).
 * - `integrationKey`: `Authorization: Bearer crm_live_...` (API de leads).
 * - `abacatePayWebhook` / `statusCollector`: segredo compartilhado em header.
 * - `metaWebhook` / `zapiWebhook`: assinatura/segredo dos webhooks do WhatsApp.
 * - `apiToken`: token pessoal `Authorization: Bearer stl_pat_...` (API v1, ADR 0035).
 */
export type AuthKind =
  | 'session'
  | 'public'
  | 'integrationKey'
  | 'abacatePayWebhook'
  | 'statusCollector'
  | 'metaWebhook'
  | 'zapiWebhook'
  | 'apiToken'

const SECURITY: Record<AuthKind, Record<string, string[]>[]> = {
  session: [{ cookieAuth: [] }],
  public: [],
  integrationKey: [{ crmIntegrationKey: [] }],
  abacatePayWebhook: [{ abacatePayWebhookSecret: [] }],
  statusCollector: [{ statusCollectorSecret: [] }],
  metaWebhook: [{ metaWebhookSignature: [] }],
  zapiWebhook: [{ zapiWebhookSecret: [] }],
  apiToken: [{ personalToken: [] }],
}

/** Chave usada pelo rate limit da rota (todas no Redis, `src/lib/rate-limit.ts`). */
export type RateLimitKind =
  | 'user'
  | 'ip'
  | 'upload'
  | 'integrationKey'
  | 'auth'
  | 'apiToken'

const RATE_LIMIT_TEXT: Record<RateLimitKind, string> = {
  user: 'por usuário',
  ip: 'por IP',
  upload: 'por usuário (limite de upload)',
  integrationKey: 'por chave de API',
  auth: 'por IP e rota',
  apiToken: 'por token e por usuário',
}

export interface ErrorSpec {
  code: ErrorCode
  /** Mensagem do exemplo (padrão: a da fábrica em `app-error.ts`). */
  message?: string
  /** Quando o erro acontece — vira o `summary` do exemplo. */
  when?: string
}

export type ErrorEntry = ErrorCode | ErrorSpec

export interface ResponseSpec {
  description: string
  /**
   * Schema de `data` (envelope padrão) ou do corpo inteiro quando
   * `envelope: false`. `null` documenta `data: null`.
   */
  schema?: SchemaSource | null
  /** `false` para respostas fora do envelope (Better Auth, binários, redirects). */
  envelope?: boolean
  /** Padrão `application/json`. */
  contentType?: string
  /** Exemplo de `data` (ou do corpo inteiro sem envelope). */
  example?: unknown
  headers?: Record<string, { description: string; schema?: JsonSchema }>
}

export interface BodySpec {
  schema: SchemaSource
  /** Padrão `application/json`. */
  contentType?: string
  description?: string
  example?: unknown
  /** Padrão `true`. */
  required?: boolean
}

export interface ParamSpec {
  description: string
  example?: string
  schema?: JsonSchema
}

export interface RouteConfig {
  method: HttpMethod
  /** Path OpenAPI relativo a `/api` (ex.: `/workspaces/{id}/projects`). */
  path: string
  tags: [TagName, ...TagName[]]
  summary: string
  description?: string
  operationId?: string
  /** Padrão `session`. */
  auth?: AuthKind
  /** Padrão `user` quando `auth: 'session'`; `false` desliga. */
  rateLimit?: RateLimitKind | false
  /** Rota exige o consentimento LGPD (termos + privacidade) — `requireConsent`. */
  consent?: boolean
  /** Descrição dos parâmetros de path (`{id}` etc.). */
  params?: Record<string, string | ParamSpec>
  /** Query string — um `z.object` (propriedades viram parâmetros). */
  query?: z.ZodType | JsonSchema
  /**
   * Padrão `true` quando `query` é Zod: a rota responde `422
   * VALIDATION_ERROR` para query inválida. `false` quando a rota trata a
   * falha com outro código.
   */
  queryValidationError?: boolean
  /** Parâmetros de header extras. */
  headers?: Record<string, ParamSpec & { required?: boolean }>
  body?: SchemaSource | BodySpec
  /** Respostas de sucesso/redirect. Erros vêm de `errors`. */
  responses: Record<number, string | ResponseSpec>
  /** Erros de domínio além dos automáticos (401/429/422/403 de consentimento). */
  errors?: ErrorEntry[]
  /**
   * Padrão `true`: adiciona os erros do envelope que decorrem da config
   * (401 da sessão, 403 do consentimento, 422 da validação Zod, 429 do rate
   * limit). `false` para rotas fora do envelope (Better Auth).
   */
  autoErrors?: boolean
  deprecated?: boolean
}

type Operation = JsonSchema

/* ------------------------------------------------------------------ */
/* Registry                                                             */
/* ------------------------------------------------------------------ */

const WORKSPACE_ID_PREFIXES = ['/workspaces/{id}', '/admin/workspaces/{id}']

function isBodySpec(value: SchemaSource | BodySpec): value is BodySpec {
  return (
    typeof value === 'object' &&
    value !== null &&
    !isZodSchema(value) &&
    !isComponentRef(value) &&
    'schema' in value &&
    !('type' in value) &&
    !('$ref' in value)
  )
}

function pathParams(path: string): string[] {
  return [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1])
}

function toOperationId(method: HttpMethod, path: string): string {
  const parts = path
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      const param = /^\{(.+)\}$/.exec(segment)
      const word = param ? `by-${param[1]}` : segment
      return word
        .split(/[^a-zA-Z0-9]+/)
        .filter(Boolean)
        .map((piece) => piece[0].toUpperCase() + piece.slice(1))
        .join('')
    })
  return method + parts.join('')
}

export class OpenApiRegistry {
  private readonly operations = new Map<string, Map<HttpMethod, Operation>>()
  private readonly schemas = new Map<string, JsonSchema>()
  private readonly componentSources = new Map<string, ComponentRef>()
  private readonly operationIds = new Set<string>()
  /** Respostas de erro geradas → nome-base do componente (`404_CRM_FORM_NOT_FOUND`). */
  private readonly errorResponseNames = new WeakMap<JsonSchema, string>()

  /** Registra uma operação. Lança em configurações inconsistentes. */
  registerRoute(config: RouteConfig): void {
    const where = `${config.method.toUpperCase()} ${config.path}`
    if (!config.path.startsWith('/') || config.path.startsWith('/api/')) {
      throw new Error(
        `${where}: path deve ser relativo a /api (ex.: /users/me)`,
      )
    }

    const byMethod = this.operations.get(config.path) ?? new Map()
    if (byMethod.has(config.method)) {
      throw new Error(`${where}: operação registrada duas vezes`)
    }

    const operationId =
      config.operationId ?? toOperationId(config.method, config.path)
    if (this.operationIds.has(operationId)) {
      throw new Error(`${where}: operationId duplicado "${operationId}"`)
    }
    this.operationIds.add(operationId)

    const auth = config.auth ?? 'session'
    const rateLimit =
      config.rateLimit === undefined
        ? auth === 'session'
          ? 'user'
          : auth === 'apiToken'
            ? 'apiToken'
            : false
        : config.rateLimit

    const operation: Operation = {
      tags: config.tags,
      summary: config.summary,
      operationId,
    }

    const notes: string[] = []
    if (config.consent) {
      notes.push(
        'Exige o consentimento LGPD do usuário (Termos de Uso e Política de Privacidade aceitos); sem ele responde `403 FORBIDDEN`.',
      )
    }
    if (rateLimit) {
      notes.push(
        `Rate limit ${RATE_LIMIT_TEXT[rateLimit]}; ao estourar responde \`429 RATE_LIMITED\` com o header \`Retry-After\`.`,
      )
    }
    const description = [config.description?.trim(), ...notes]
      .filter(Boolean)
      .join('\n\n')
    if (description) operation.description = description
    if (config.deprecated) operation.deprecated = true

    const parameters = [
      ...this.buildPathParams(config, where),
      ...this.buildQueryParams(config, operationId),
      ...this.buildHeaderParams(config),
    ]
    if (parameters.length > 0) operation.parameters = parameters

    if (config.body) {
      operation.requestBody = this.buildBody(config.body, operationId)
    }

    operation.responses = this.buildResponses(
      config,
      auth,
      rateLimit,
      operationId,
      where,
    )
    operation.security = SECURITY[auth]

    byMethod.set(config.method, operation)
    this.operations.set(config.path, byMethod)
  }

  /** Converte uma fonte de schema em JSON Schema (registrando componentes). */
  resolveSchema(
    source: SchemaSource,
    io: SchemaIo,
    defsPrefix: string,
  ): JsonSchema {
    if (isComponentRef(source)) {
      this.ensureComponent(source)
      return { $ref: `#/components/schemas/${source.name}` }
    }
    if (isZodSchema(source)) {
      const converted = zodToJsonSchema(source, io, `${defsPrefix}_`)
      this.addSchemas(converted.defs)
      // `.meta({ id })` no topo: vira componente nomeado + `$ref`.
      const id = schemaId(source)
      if (id) {
        this.addSchemas({ [id]: converted.schema })
        return { $ref: `#/components/schemas/${id}` }
      }
      return converted.schema
    }
    return source
  }

  /** Paths ordenados + schemas ordenados, prontos para o documento. */
  build(): {
    paths: Record<string, Record<string, Operation>>
    schemas: Record<string, JsonSchema>
    responses: Record<string, JsonSchema>
    usedTags: Set<string>
  } {
    const errorRefs = this.nameErrorResponses()
    const usedTags = new Set<string>()
    const paths: Record<string, Record<string, Operation>> = {}
    for (const path of [...this.operations.keys()].sort(compareStrings)) {
      const byMethod = this.operations.get(path) as Map<HttpMethod, Operation>
      const item: Record<string, Operation> = {}
      for (const method of HTTP_METHODS) {
        const operation = byMethod.get(method)
        if (!operation) continue
        for (const tag of operation.tags as string[]) usedTags.add(tag)
        const responses = Object.fromEntries(
          Object.entries(operation.responses as Record<string, JsonSchema>).map(
            ([status, response]) => {
              const name = errorRefs.byResponse.get(response)
              return [
                status,
                name ? { $ref: `#/components/responses/${name}` } : response,
              ]
            },
          ),
        )
        item[method] = { ...operation, responses }
      }
      paths[path] = item
    }

    const schemas: Record<string, JsonSchema> = {}
    for (const name of [...this.schemas.keys()].sort(compareStrings)) {
      schemas[name] = this.schemas.get(name) as JsonSchema
    }
    return { paths, schemas, responses: errorRefs.components, usedTags }
  }

  /**
   * Respostas de erro idênticas viram um único `components.responses`
   * (`404_CRM_FORM_NOT_FOUND`, `422_VALIDATION_ERROR_2`...). A variante mais
   * usada fica com o nome-base; as demais ganham sufixo pela ordem de uso e
   * do conteúdo — independente da ordem de registro.
   */
  private nameErrorResponses(): {
    byResponse: Map<JsonSchema, string>
    components: Record<string, JsonSchema>
  } {
    const variants = new Map<string, Map<string, JsonSchema[]>>()
    for (const byMethod of this.operations.values()) {
      for (const operation of byMethod.values()) {
        for (const response of Object.values(
          operation.responses as Record<string, JsonSchema>,
        )) {
          const base = this.errorResponseNames.get(response)
          if (!base) continue
          const byContent =
            variants.get(base) ?? new Map<string, JsonSchema[]>()
          const key = JSON.stringify(response)
          byContent.set(key, [...(byContent.get(key) ?? []), response])
          variants.set(base, byContent)
        }
      }
    }

    const byResponse = new Map<JsonSchema, string>()
    const components: Record<string, JsonSchema> = {}
    for (const base of [...variants.keys()].sort(compareStrings)) {
      const byContent = variants.get(base) as Map<string, JsonSchema[]>
      // A variante mais usada fica com o nome-base; empate → ordem do conteúdo.
      const keys = [...byContent.keys()].sort(
        (a, b) =>
          (byContent.get(b)?.length ?? 0) - (byContent.get(a)?.length ?? 0) ||
          compareStrings(a, b),
      )
      keys.forEach((key, index) => {
        const name = index === 0 ? base : `${base}_${index + 1}`
        const responses = byContent.get(key) as JsonSchema[]
        components[name] = responses[0]
        for (const response of responses) byResponse.set(response, name)
      })
    }
    return { byResponse, components }
  }

  /** `METHOD /path` de todas as operações registradas. */
  listOperations(): string[] {
    const out: string[] = []
    for (const [path, byMethod] of this.operations) {
      for (const method of byMethod.keys()) {
        out.push(`${method.toUpperCase()} ${path}`)
      }
    }
    return out.sort(compareStrings)
  }

  /** Adiciona um schema fixo (envelope, erros...) em `components.schemas`. */
  addSchema(name: string, schema: JsonSchema): void {
    this.addSchemas({ [name]: schema })
  }

  private addSchemas(schemas: Record<string, JsonSchema>): void {
    for (const [name, schema] of Object.entries(schemas)) {
      const existing = this.schemas.get(name)
      if (existing && JSON.stringify(existing) !== JSON.stringify(schema)) {
        throw new Error(
          `components.schemas.${name} definido com conteúdos diferentes`,
        )
      }
      this.schemas.set(name, schema)
    }
  }

  private ensureComponent(ref: ComponentRef): void {
    const known = this.componentSources.get(ref.name)
    if (known) {
      if (known.source !== ref.source || known.io !== ref.io) {
        throw new Error(
          `componente "${ref.name}" declarado duas vezes com fontes diferentes`,
        )
      }
      return
    }
    this.componentSources.set(ref.name, ref)
    const schema = isZodSchema(ref.source)
      ? (() => {
          const converted = zodToJsonSchema(ref.source, ref.io, `${ref.name}_`)
          this.addSchemas(converted.defs)
          return converted.schema
        })()
      : ref.source
    this.addSchemas({ [ref.name]: schema })
  }

  private buildPathParams(config: RouteConfig, where: string): JsonSchema[] {
    const names = pathParams(config.path)
    const described = Object.keys(config.params ?? {})
    for (const name of described) {
      if (!names.includes(name)) {
        throw new Error(`${where}: parâmetro "${name}" não existe no path`)
      }
    }

    return names.map((name) => {
      const spec = config.params?.[name]
      if (
        !spec &&
        name === 'id' &&
        WORKSPACE_ID_PREFIXES.some((prefix) => config.path.startsWith(prefix))
      ) {
        return { $ref: '#/components/parameters/WorkspaceId' }
      }
      if (!spec) {
        throw new Error(
          `${where}: descreva o parâmetro de path "${name}" em params`,
        )
      }
      const param = typeof spec === 'string' ? { description: spec } : spec
      return {
        name,
        in: 'path',
        required: true,
        description: param.description,
        schema: param.schema ?? { type: 'string' },
        ...(param.example !== undefined && { example: param.example }),
      }
    })
  }

  private buildQueryParams(
    config: RouteConfig,
    operationId: string,
  ): JsonSchema[] {
    if (!config.query) return []
    const schema = this.resolveSchema(config.query, 'input', operationId)
    const properties = (schema.properties ?? {}) as Record<string, JsonSchema>
    const required = new Set((schema.required ?? []) as string[])
    return Object.entries(properties).map(([name, property]) => {
      const { description, ...rest } = property
      return {
        name,
        in: 'query',
        required: required.has(name),
        ...(typeof description === 'string' && { description }),
        schema: rest,
      }
    })
  }

  private buildHeaderParams(config: RouteConfig): JsonSchema[] {
    return Object.entries(config.headers ?? {}).map(([name, spec]) => ({
      name,
      in: 'header',
      required: spec.required ?? false,
      description: spec.description,
      schema: spec.schema ?? { type: 'string' },
      ...(spec.example !== undefined && { example: spec.example }),
    }))
  }

  private buildBody(
    body: SchemaSource | BodySpec,
    operationId: string,
  ): JsonSchema {
    const spec: BodySpec = isBodySpec(body) ? body : { schema: body }
    const media: JsonSchema = {
      schema: this.resolveSchema(spec.schema, 'input', `${operationId}Body`),
    }
    if (spec.example !== undefined) media.example = spec.example
    return {
      required: spec.required ?? true,
      ...(spec.description && { description: spec.description }),
      content: { [spec.contentType ?? 'application/json']: media },
    }
  }

  private buildResponses(
    config: RouteConfig,
    auth: AuthKind,
    rateLimit: RateLimitKind | false,
    operationId: string,
    where: string,
  ): Record<string, JsonSchema> {
    const responses: Record<string, JsonSchema> = {}

    for (const [status, raw] of Object.entries(config.responses)) {
      const spec: ResponseSpec =
        typeof raw === 'string' ? { description: raw } : raw
      responses[status] = this.buildSuccess(
        Number(status),
        spec,
        `${operationId}${status}`,
      )
    }

    const errors: ErrorSpec[] = []
    const auto = config.autoErrors ?? true
    if (auto && auth === 'session')
      errors.push({ code: 'UNAUTHORIZED', when: 'Sem sessão válida' })
    if (auto && auth === 'apiToken')
      errors.push({
        code: 'UNAUTHORIZED',
        message: 'Token de API inválido',
        when: 'Token ausente, inválido, vencido ou revogado',
      })
    if (auto && config.consent) {
      errors.push({
        code: 'FORBIDDEN',
        message: 'Consentimento obrigatório',
        when: 'Consentimento LGPD pendente',
      })
    }
    if (auto && config.body && isZodBody(config.body)) {
      errors.push({
        code: 'VALIDATION_ERROR',
        when: 'Corpo inválido ou JSON malformado',
      })
    }
    if (
      auto &&
      config.query &&
      isZodSchema(config.query) &&
      config.queryValidationError !== false
    ) {
      errors.push({
        code: 'VALIDATION_ERROR',
        message: 'Parâmetros inválidos',
        when: 'Query inválida',
      })
    }
    if (auto && rateLimit)
      errors.push({
        code: 'RATE_LIMITED',
        when: 'Limite de requisições excedido',
      })
    for (const entry of config.errors ?? []) {
      errors.push(typeof entry === 'string' ? { code: entry } : entry)
    }

    const byStatus = new Map<number, ErrorSpec[]>()
    for (const spec of errors) {
      if (!(spec.code in ERROR_CODES)) {
        throw new Error(`${where}: código de erro desconhecido "${spec.code}"`)
      }
      const status = statusOf(spec.code)
      const list = byStatus.get(status) ?? []
      // O mesmo código com a mesma mensagem não se repete.
      if (
        !list.some(
          (item) => item.code === spec.code && item.message === spec.message,
        )
      ) {
        list.push(spec)
      }
      byStatus.set(status, list)
    }

    for (const status of [...byStatus.keys()].sort((a, b) => a - b)) {
      if (responses[status]) {
        throw new Error(
          `${where}: status ${status} documentado como sucesso e como erro`,
        )
      }
      responses[status] = this.buildErrorResponse(
        status,
        byStatus.get(status) as ErrorSpec[],
      )
    }

    const ordered: Record<string, JsonSchema> = {}
    for (const status of Object.keys(responses).sort(
      (a, b) => Number(a) - Number(b),
    )) {
      ordered[status] = responses[status]
    }
    return ordered
  }

  private buildSuccess(
    status: number,
    spec: ResponseSpec,
    defsPrefix: string,
  ): JsonSchema {
    const response: JsonSchema = { description: spec.description }
    if (spec.headers) {
      response.headers = Object.fromEntries(
        Object.entries(spec.headers).map(([name, header]) => [
          name,
          {
            description: header.description,
            schema: header.schema ?? { type: 'string' },
          },
        ]),
      )
    }

    const envelope = spec.envelope ?? true
    if (!envelope) {
      if (spec.schema === undefined && spec.example === undefined)
        return response
      const media: JsonSchema = {}
      if (spec.schema !== undefined) {
        media.schema =
          spec.schema === null
            ? { type: 'null' }
            : this.resolveSchema(spec.schema, 'output', defsPrefix)
      }
      if (spec.example !== undefined) media.example = spec.example
      response.content = { [spec.contentType ?? 'application/json']: media }
      return response
    }

    const data =
      spec.schema === undefined
        ? {}
        : spec.schema === null
          ? { type: 'null' }
          : this.resolveSchema(spec.schema, 'output', defsPrefix)

    const media: JsonSchema = {
      schema: {
        allOf: [
          { $ref: '#/components/schemas/SuccessEnvelope' },
          { type: 'object', properties: { data } },
        ],
      },
    }
    if (spec.example !== undefined || spec.schema === null) {
      media.example = {
        success: true,
        statusCode: status,
        data: spec.schema === null ? null : spec.example,
      }
    }
    response.content = { 'application/json': media }
    return response
  }

  private buildErrorResponse(status: number, specs: ErrorSpec[]): JsonSchema {
    const codes = [...new Set(specs.map((spec) => spec.code))].sort(
      (a, b) => ERROR_CODE_LIST.indexOf(a) - ERROR_CODE_LIST.indexOf(b),
    )
    const title = STATUS_TITLES[status] ?? `Erro ${status}`
    const examples: Record<string, JsonSchema> = {}
    const counts = new Map<string, number>()
    for (const spec of specs) {
      const n = (counts.get(spec.code) ?? 0) + 1
      counts.set(spec.code, n)
      const key = n === 1 ? spec.code : `${spec.code}_${n}`
      examples[key] = {
        summary: spec.when ? `${spec.code} — ${spec.when}` : spec.code,
        value: errorExample(
          spec.code,
          spec.message ?? defaultMessage(spec.code),
        ),
      }
    }

    const response: JsonSchema = {
      description: `${title}: ${codes.map((code) => `\`${code}\``).join(', ')}`,
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/ErrorResponse' },
          examples,
        },
      },
    }
    if (status === 429) {
      response.headers = {
        'Retry-After': {
          description: 'Segundos até a próxima tentativa ser aceita.',
          schema: { type: 'integer' },
        },
      }
    }
    this.errorResponseNames.set(response, `${status}_${codes.join('_')}`)
    return response
  }
}

function isZodBody(body: SchemaSource | BodySpec): boolean {
  if (isBodySpec(body))
    return isZodSchema(body.schema) || isComponentZod(body.schema)
  return isZodSchema(body) || isComponentZod(body)
}

function isComponentZod(source: SchemaSource): boolean {
  return isComponentRef(source) && isZodSchema(source.source)
}

export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
