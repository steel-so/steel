import { z } from 'zod'
import { WEBHOOK_EVENT_MODULES } from '@/src/lib/webhooks/events'
import {
  CreateWebhookEndpointSchema,
  ListWebhookDeliveriesQuerySchema,
  TriggerWebhookEventSchema,
  UpdateWebhookEndpointSchema,
  WEBHOOK_DELIVERY_STATUSES,
  WEBHOOK_ENDPOINT_LIMIT,
  WEBHOOK_EVENT_TYPE_VALUES,
} from '@/src/schemas/webhook.schema'
import { dto, WORKSPACE_PRIVILEGED_ERRORS } from '../common'
import type { ErrorEntry, OpenApiRegistry, RouteConfig } from '../registry'

/**
 * Outbound webhooks (ADR 0036): the settings page routes
 * (`/workspaces/{id}/webhooks/**`, session) and the API v1 routes
 * (`/v1/webhooks/**`, personal token).
 */

const APP_TAG = 'Webhooks de saída' as const
const V1_TAG = 'API v1 · Webhooks' as const
const APP = '/workspaces/{id}/webhooks'
const V1 = '/v1/webhooks'

const SIGNATURE = `Cada entrega é um \`POST\` JSON com o corpo \`{ id, type, createdAt, workspaceId, data }\` e os cabeçalhos \`Steel-Webhook-Id\` (id do evento, o mesmo nas novas tentativas), \`Steel-Webhook-Timestamp\` (Unix, segundos) e \`Steel-Signature\` (\`v1=<hex do HMAC-SHA256 de "<timestamp>.<corpo>">\` com o segredo do endpoint). Até 6 tentativas com espera crescente (1, 2, 4, 8 e 16 min); só \`2xx\` confirma; um endpoint que falha por 3 dias seguidos é desativado e os administradores são avisados.`
const PRIVILEGED = 'Acesso: **OWNER/ADMIN** do workspace.'
const V1_ACCESS =
  'Token pessoal (`stl_pat_`) de **OWNER/ADMIN**; o workspace é o do token.'
const V1_WRITE = `${V1_ACCESS} Exige o escopo \`api:write\`.`

const dateTime = () => z.iso.datetime()

const WebhookEventTypeDTO = dto(
  'WebhookEventType',
  z.object({
    type: z.enum(WEBHOOK_EVENT_TYPE_VALUES as [string, ...string[]]),
    module: z.enum(WEBHOOK_EVENT_MODULES),
    description: z.string().meta({ description: 'pt-BR.' }),
    subscribable: z.boolean().meta({
      description: '`false` só para `steel.ping` (enviado sob demanda).',
    }),
  }),
)

const WebhookEndpointDTO = dto(
  'WebhookEndpoint',
  z.object({
    id: z.string(),
    workspaceId: z.string(),
    url: z.string().meta({ example: 'https://erp.example.com/steel' }),
    description: z.string().nullable(),
    events: z.array(z.string()).meta({
      description: 'Tipos do catálogo, ou `["*"]` para todos.',
      example: ['servicedesk.ticket.created', 'crm.deal.won'],
    }),
    active: z.boolean(),
    secretHint: z.string().meta({
      description: 'Só os 4 últimos caracteres do segredo.',
      example: 'whsec_…a1b2',
    }),
    disabledAt: dateTime().nullable(),
    disabledReason: z.string().nullable().meta({
      description:
        '`manual` (desligado por alguém) ou `auto` (3 dias falhando).',
    }),
    failingSince: dateTime().nullable().meta({
      description: 'Primeira falha desde o último sucesso.',
    }),
    lastSuccessAt: dateTime().nullable(),
    lastFailureAt: dateTime().nullable(),
    createdById: z.string(),
    createdAt: dateTime(),
    updatedAt: dateTime(),
  }),
)

const WithSecretDTO = z.object({
  endpoint: WebhookEndpointDTO,
  secret: z.string().meta({
    description: 'Segredo de assinatura. Guarde: só volta aqui.',
    example: 'whsec_3q2-7wE…',
  }),
})

const WebhookDeliveryDTO = dto(
  'WebhookDelivery',
  z.object({
    id: z.string(),
    endpointId: z.string(),
    eventId: z.string().meta({ example: 'evt_cm2…' }),
    eventType: z.string(),
    status: z.enum(WEBHOOK_DELIVERY_STATUSES),
    attempts: z.number().int(),
    responseStatus: z.number().int().nullable(),
    responseBody: z
      .string()
      .nullable()
      .meta({ description: 'Primeiro 1 KB da resposta.' }),
    durationMs: z.number().int().nullable(),
    error: z.string().nullable().meta({
      example: 'http_500',
      description:
        '`http_<status>`, `timeout`, `network_error: …`, `url_not_allowed: …`, `endpoint_disabled`…',
    }),
    requestBody: z.string().meta({ description: 'Corpo JSON exato enviado.' }),
    lastAttemptAt: dateTime().nullable(),
    deliveredAt: dateTime().nullable(),
    createdAt: dateTime(),
  }),
)

const page = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() })

const ENDPOINT_NOT_FOUND: ErrorEntry = {
  code: 'WEBHOOK_ENDPOINT_NOT_FOUND',
  when: 'Endpoint inexistente, removido ou de outro workspace',
}
const DELIVERY_NOT_FOUND: ErrorEntry = {
  code: 'WEBHOOK_DELIVERY_NOT_FOUND',
  when: 'Entrega inexistente (ou já fora dos 30 dias de retenção)',
}
const URL_REFUSED: ErrorEntry = {
  code: 'WEBHOOK_URL_NOT_ALLOWED',
  when: 'URL sem HTTPS, com usuário e senha, ou que resolve para IP privado, loopback ou link-local',
}
const LIMIT: ErrorEntry = {
  code: 'WEBHOOK_ENDPOINT_LIMIT_REACHED',
  when: `O workspace já tem ${WEBHOOK_ENDPOINT_LIMIT} endpoints`,
}
const V1_ERRORS: ErrorEntry[] = [
  { code: 'FORBIDDEN', when: 'O dono do token não é OWNER/ADMIN' },
  'WORKSPACE_SUSPENDED',
]
const V1_WRITE_ERRORS: ErrorEntry[] = [
  {
    code: 'FORBIDDEN',
    when: 'Token sem `api:write`, ou o dono não é OWNER/ADMIN',
  },
  'WORKSPACE_SUSPENDED',
]

const DELIVERY_QUERY_NOTE =
  'Mais novas primeiro. Paginação por cursor: `limit` (padrão 25, máximo 100) e `cursor` (o `nextCursor` da página anterior). Retenção de 30 dias.'

function app(route: Omit<RouteConfig, 'tags'>): RouteConfig {
  return { ...route, tags: [APP_TAG] }
}

function v1(
  route: Omit<RouteConfig, 'tags' | 'auth' | 'rateLimit'>,
): RouteConfig {
  return { ...route, tags: [V1_TAG], auth: 'apiToken', rateLimit: 'apiToken' }
}

const routes: RouteConfig[] = [
  /* ------------------------------ settings page ----------------------------- */
  app({
    method: 'get',
    path: `${APP}/endpoints`,
    summary: 'Listar endpoints',
    description: `Endpoints do workspace, mais antigos primeiro (até ${WEBHOOK_ENDPOINT_LIMIT}). ${PRIVILEGED}`,
    params: { id: 'ID do workspace.' },
    responses: {
      200: { description: 'Endpoints.', schema: page(WebhookEndpointDTO) },
    },
    errors: WORKSPACE_PRIVILEGED_ERRORS,
  }),
  app({
    method: 'post',
    path: `${APP}/endpoints`,
    summary: 'Cadastrar endpoint',
    description: `Valida a URL (HTTPS público, sem redirecionamento) e gera o segredo, que só volta nesta resposta, na troca e no "revelar". ${SIGNATURE} ${PRIVILEGED}`,
    consent: true,
    params: { id: 'ID do workspace.' },
    body: CreateWebhookEndpointSchema,
    responses: {
      201: { description: 'Endpoint e segredo.', schema: WithSecretDTO },
    },
    errors: [...WORKSPACE_PRIVILEGED_ERRORS, URL_REFUSED, LIMIT],
  }),
  app({
    method: 'patch',
    path: `${APP}/endpoints/{endpointId}`,
    summary: 'Alterar endpoint',
    description: `URL, descrição, eventos e ativo. Reativar limpa o estado de falha. ${PRIVILEGED}`,
    consent: true,
    params: { id: 'ID do workspace.', endpointId: 'ID do endpoint.' },
    body: UpdateWebhookEndpointSchema,
    responses: {
      200: { description: 'Endpoint.', schema: WebhookEndpointDTO },
    },
    errors: [...WORKSPACE_PRIVILEGED_ERRORS, ENDPOINT_NOT_FOUND, URL_REFUSED],
  }),
  app({
    method: 'delete',
    path: `${APP}/endpoints/{endpointId}`,
    summary: 'Remover endpoint',
    description: `Para de enviar na hora; entregas pendentes são descartadas. ${PRIVILEGED}`,
    consent: true,
    params: { id: 'ID do workspace.', endpointId: 'ID do endpoint.' },
    responses: {
      200: { description: 'Removido.', schema: z.object({ id: z.string() }) },
    },
    errors: [...WORKSPACE_PRIVILEGED_ERRORS, ENDPOINT_NOT_FOUND],
  }),
  app({
    method: 'post',
    path: `${APP}/endpoints/{endpointId}/test`,
    summary: 'Enviar teste',
    description: `Envia um \`steel.ping\` só para este endpoint, na hora (uma tentativa, mesmo desativado), e devolve a entrega com o código e o tempo da resposta. Não conta para a desativação automática. ${PRIVILEGED}`,
    consent: true,
    params: { id: 'ID do workspace.', endpointId: 'ID do endpoint.' },
    responses: {
      200: { description: 'Entrega do teste.', schema: WebhookDeliveryDTO },
    },
    errors: [...WORKSPACE_PRIVILEGED_ERRORS, ENDPOINT_NOT_FOUND],
  }),
  app({
    method: 'get',
    path: `${APP}/endpoints/{endpointId}/secret`,
    summary: 'Revelar segredo',
    description: `Devolve o segredo de assinatura (registrado na auditoria). ${PRIVILEGED}`,
    params: { id: 'ID do workspace.', endpointId: 'ID do endpoint.' },
    responses: {
      200: {
        description: 'Segredo.',
        schema: z.object({ secret: z.string() }),
      },
    },
    errors: [...WORKSPACE_PRIVILEGED_ERRORS, ENDPOINT_NOT_FOUND],
  }),
  app({
    method: 'post',
    path: `${APP}/endpoints/{endpointId}/secret`,
    summary: 'Trocar segredo',
    description: `Gera um segredo novo, válido já na próxima entrega: atualize o seu sistema logo em seguida. ${PRIVILEGED}`,
    consent: true,
    params: { id: 'ID do workspace.', endpointId: 'ID do endpoint.' },
    responses: {
      200: { description: 'Endpoint e segredo novo.', schema: WithSecretDTO },
    },
    errors: [...WORKSPACE_PRIVILEGED_ERRORS, ENDPOINT_NOT_FOUND],
  }),
  app({
    method: 'get',
    path: `${APP}/deliveries`,
    summary: 'Log de entregas',
    description: `${DELIVERY_QUERY_NOTE} ${PRIVILEGED}`,
    params: { id: 'ID do workspace.' },
    query: ListWebhookDeliveriesQuerySchema,
    responses: {
      200: {
        description: 'Página de entregas.',
        schema: page(WebhookDeliveryDTO),
      },
    },
    errors: [...WORKSPACE_PRIVILEGED_ERRORS, ENDPOINT_NOT_FOUND],
  }),
  app({
    method: 'post',
    path: `${APP}/deliveries/{deliveryId}/retry`,
    summary: 'Reenviar entrega',
    description: `Mais uma tentativa da mesma entrega (mesmo corpo e mesmo \`Steel-Webhook-Id\`), também para endpoint desativado. Responde \`202\` com a entrega em \`PENDING\`. ${PRIVILEGED}`,
    consent: true,
    params: { id: 'ID do workspace.', deliveryId: 'ID da entrega.' },
    responses: {
      202: { description: 'Reenvio na fila.', schema: WebhookDeliveryDTO },
    },
    errors: [
      ...WORKSPACE_PRIVILEGED_ERRORS,
      DELIVERY_NOT_FOUND,
      ENDPOINT_NOT_FOUND,
    ],
  }),

  /* --------------------------------- API v1 --------------------------------- */
  v1({
    method: 'get',
    path: `${V1}/events`,
    summary: 'Catálogo de eventos',
    description:
      'Tipos de evento que o Steel envia, com módulo e descrição. Eventos de módulos fora do token não aparecem. O formato do `data` de cada tipo segue a regra de estabilidade da API v1.',
    responses: {
      200: { description: 'Catálogo.', schema: z.array(WebhookEventTypeDTO) },
    },
  }),
  v1({
    method: 'get',
    path: `${V1}/endpoints`,
    summary: 'Listar endpoints',
    description: V1_ACCESS,
    responses: {
      200: { description: 'Endpoints.', schema: page(WebhookEndpointDTO) },
    },
    errors: V1_ERRORS,
  }),
  v1({
    method: 'post',
    path: `${V1}/endpoints`,
    summary: 'Cadastrar endpoint',
    description: `${SIGNATURE} ${V1_WRITE}`,
    body: CreateWebhookEndpointSchema,
    responses: {
      201: { description: 'Endpoint e segredo.', schema: WithSecretDTO },
    },
    errors: [...V1_WRITE_ERRORS, URL_REFUSED, LIMIT],
  }),
  v1({
    method: 'patch',
    path: `${V1}/endpoints/{id}`,
    summary: 'Alterar endpoint',
    description: V1_WRITE,
    params: { id: 'ID do endpoint.' },
    body: UpdateWebhookEndpointSchema,
    responses: {
      200: { description: 'Endpoint.', schema: WebhookEndpointDTO },
    },
    errors: [...V1_WRITE_ERRORS, ENDPOINT_NOT_FOUND, URL_REFUSED],
  }),
  v1({
    method: 'delete',
    path: `${V1}/endpoints/{id}`,
    summary: 'Remover endpoint',
    description: V1_WRITE,
    params: { id: 'ID do endpoint.' },
    responses: {
      200: { description: 'Removido.', schema: z.object({ id: z.string() }) },
    },
    errors: [...V1_WRITE_ERRORS, ENDPOINT_NOT_FOUND],
  }),
  v1({
    method: 'post',
    path: `${V1}/endpoints/{id}/test`,
    summary: 'Enviar teste',
    description: `Um \`steel.ping\` só para este endpoint, na hora; devolve a entrega. ${V1_WRITE}`,
    params: { id: 'ID do endpoint.' },
    responses: {
      200: { description: 'Entrega do teste.', schema: WebhookDeliveryDTO },
    },
    errors: [...V1_WRITE_ERRORS, ENDPOINT_NOT_FOUND],
  }),
  v1({
    method: 'get',
    path: `${V1}/deliveries`,
    summary: 'Log de entregas',
    description: `${DELIVERY_QUERY_NOTE} ${V1_ACCESS}`,
    query: ListWebhookDeliveriesQuerySchema,
    responses: {
      200: {
        description: 'Página de entregas.',
        schema: page(WebhookDeliveryDTO),
      },
    },
    errors: [...V1_ERRORS, ENDPOINT_NOT_FOUND],
  }),
  v1({
    method: 'post',
    path: `${V1}/deliveries/{id}/retry`,
    summary: 'Reenviar entrega',
    description: `Mais uma tentativa da mesma entrega. ${V1_WRITE}`,
    params: { id: 'ID da entrega.' },
    responses: {
      202: { description: 'Reenvio na fila.', schema: WebhookDeliveryDTO },
    },
    errors: [...V1_WRITE_ERRORS, DELIVERY_NOT_FOUND, ENDPOINT_NOT_FOUND],
  }),
  v1({
    method: 'get',
    path: `${V1}/listen`,
    summary: 'Escutar eventos (SSE)',
    description: `Para o \`steel listen\`: Server-Sent Events com os eventos do workspace em tempo real (Redis pub/sub), sem replay. Primeiro \`event: ready\` com \`{ workspaceId, events, secret }\` — o segredo de assinatura desta escuta, fixo por membro e workspace. Depois, a cada evento, \`event: webhook\` com \`{ id, timestamp, signature, body }\`: o corpo exato e os valores dos três cabeçalhos \`Steel-Webhook-*\`, para o CLI repassar idêntico. Heartbeat \`: ping\` a cada 25 s. \`?events=a,b\` filtra; os módulos do token sempre valem. ${V1_ACCESS}`,
    query: z.object({
      events: z.string().optional().meta({
        description: 'Tipos separados por vírgula; vazio = todos.',
        example: 'servicedesk.ticket.created,crm.deal.won',
      }),
    }),
    responses: {
      200: {
        description: 'Stream SSE aberto.',
        envelope: false,
        contentType: 'text/event-stream',
        example:
          'event: ready\ndata: {"workspaceId":"cm2…","events":[],"secret":"whsec_…"}\n\nevent: webhook\nid: evt_cm2…\ndata: {"id":"evt_cm2…","timestamp":1760788800,"signature":"v1=5257a8…","body":"{\\"id\\":\\"evt_cm2…\\",\\"type\\":\\"crm.lead.created\\",…}"}\n\n: ping\n\n',
      },
    },
    errors: V1_ERRORS,
  }),
  v1({
    method: 'post',
    path: `${V1}/trigger`,
    summary: 'Disparar evento de teste',
    description: `Para o \`steel trigger\`: cria um evento do tipo pedido com os dados de exemplo do catálogo. Chega a quem está escutando (\`steel listen\`) e, com \`endpointId\`, a esse endpoint — nunca aos outros endpoints inscritos, para um teste não cair numa integração de produção. ${V1_WRITE}`,
    body: TriggerWebhookEventSchema,
    responses: {
      202: {
        description: 'Evento criado.',
        schema: z.object({
          event: z.object({ id: z.string(), type: z.string() }),
          deliveries: z.number().int().meta({
            description: 'Entregas na fila (0 quando só os ouvintes recebem).',
          }),
        }),
      },
    },
    errors: [
      ...V1_WRITE_ERRORS,
      ENDPOINT_NOT_FOUND,
      {
        code: 'FORBIDDEN',
        message: 'Este token não tem acesso ao módulo deste evento.',
        when: 'O evento é de um módulo fora do token',
      },
    ],
  }),
]

export function registerWebhookPaths(registry: OpenApiRegistry): void {
  for (const route of routes) registry.registerRoute(route)
}
