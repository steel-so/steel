import type { ModuleKind } from '@prisma/client'
import { z } from 'zod'

/**
 * Catalog of the outbound webhook events (ADR 0036). Pure data + Zod — no
 * I/O — so the emitter, the routes, the settings page and the tests read one
 * source of truth.
 *
 * **Public contract:** the `type` names and the `data` shapes follow the
 * same stability rule as the API v1 (ADR 0035): new optional fields may
 * appear; removing a field, changing a type or making a field required needs
 * a new event type and a deprecation period.
 */

export const WEBHOOK_EVENT_MODULES = [
  'SERVICE_DESK',
  'CRM',
  'COMMUNICATION',
  'AGENTS',
  'PLATFORM',
] as const
export type WebhookEventModule = (typeof WEBHOOK_EVENT_MODULES)[number]

export const WEBHOOK_EVENT_MODULE_LABEL: Record<WebhookEventModule, string> = {
  SERVICE_DESK: 'ServiceDesk',
  CRM: 'CRM',
  COMMUNICATION: 'Comunicação',
  AGENTS: 'Steel Agents',
  PLATFORM: 'Plataforma',
}

/** `null`: not tied to a module (always visible to a token). */
export function webhookEventModuleKind(
  module: WebhookEventModule,
): ModuleKind | null {
  return module === 'SERVICE_DESK' ||
    module === 'CRM' ||
    module === 'COMMUNICATION'
    ? module
    : null
}

/** Subscribes an endpoint to every event of the catalog. */
export const WEBHOOK_ALL_EVENTS = '*'

/** The test event sent by "Enviar teste" (`POST .../endpoints/{id}/test`). */
export const WEBHOOK_PING_EVENT = 'steel.ping'

/* --------------------------------- shapes --------------------------------- */

const isoDate = z.string().meta({ description: 'Data e hora ISO 8601 (UTC).' })

const SdTicketRefSchema = z.object({
  id: z.string(),
  number: z.number().int(),
  /** `INC-000123`, with the workspace prefixes. */
  code: z.string(),
  title: z.string(),
})

const SdTicketSnapshotSchema = SdTicketRefSchema.extend({
  type: z.enum(['INCIDENT', 'SERVICE_REQUEST', 'CHANGE', 'PROBLEM']),
  channel: z.string(),
  phase: z.object({ id: z.string(), name: z.string(), category: z.string() }),
  priority: z.object({ id: z.string(), name: z.string() }).nullable(),
  departmentId: z.string().nullable(),
  assigneeId: z.string().nullable(),
  requesterId: z.string().nullable(),
  createdAt: isoDate,
  updatedAt: isoDate,
})

const SdTicketEventSchema = z.object({
  ticket: SdTicketRefSchema,
  actorId: z.string().nullable(),
  /** pt-BR texts of the notification (title and body). */
  summary: z.object({ title: z.string(), body: z.string() }),
})

const DealSchema = z.object({
  source: z.enum(['lead', 'opportunity']),
  id: z.string(),
  name: z.string(),
  amount: z.number().nullable(),
  ownerId: z.string().nullable(),
  actorId: z.string().nullable(),
})

const StageSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.enum(['OPEN', 'WON', 'LOST']),
})

export const WEBHOOK_DATA_SCHEMAS = {
  'steel.ping': z.object({ message: z.string() }),
  'servicedesk.ticket.created': z.object({
    ticket: SdTicketSnapshotSchema,
    actorId: z.string().nullable(),
  }),
  'servicedesk.ticket.updated': z.object({
    ticket: SdTicketSnapshotSchema,
    actorId: z.string().nullable(),
    change: z.enum(['fields', 'assigned', 'phase']),
  }),
  'servicedesk.ticket.assigned': SdTicketEventSchema,
  'servicedesk.ticket.message': SdTicketEventSchema,
  'servicedesk.ticket.resolved': SdTicketEventSchema,
  'servicedesk.ticket.reopened': SdTicketEventSchema,
  'servicedesk.ticket.escalated': SdTicketEventSchema,
  'servicedesk.ticket.csat': SdTicketEventSchema,
  'servicedesk.sla.at_risk': SdTicketEventSchema,
  'servicedesk.sla.breached': SdTicketEventSchema,
  'servicedesk.approval.requested': SdTicketEventSchema,
  'servicedesk.approval.responded': SdTicketEventSchema,
  'crm.lead.created': z.object({
    lead: z.object({
      id: z.string(),
      name: z.string(),
      emails: z.array(z.string()),
      phones: z.array(z.string()),
      company: z.string().nullable(),
      source: z.string().nullable(),
      channel: z.string().nullable(),
      score: z.number(),
      ownerId: z.string().nullable(),
      createdAt: isoDate,
    }),
  }),
  'crm.opportunity.stage_changed': z.object({
    opportunity: z.object({
      id: z.string(),
      name: z.string(),
      amount: z.number().nullable(),
      pipelineId: z.string(),
      ownerId: z.string().nullable(),
    }),
    fromStage: StageSchema.nullable(),
    toStage: StageSchema,
    actorId: z.string().nullable(),
  }),
  'crm.deal.won': DealSchema,
  'crm.deal.lost': DealSchema,
  'communication.message.received': z.object({
    message: z.object({
      id: z.string(),
      conversationId: z.string(),
      type: z.string(),
      text: z.string().nullable(),
      providerMessageId: z.string().nullable(),
      receivedAt: isoDate,
    }),
    contact: z.object({
      id: z.string(),
      waId: z.string(),
      name: z.string().nullable(),
    }),
    connectionId: z.string(),
  }),
  'communication.conversation.waiting': z.object({
    conversation: z.object({
      id: z.string(),
      status: z.enum(['NEW', 'IN_PROGRESS']),
      connectionId: z.string(),
      /** Team queue it waits in; `null` = the general queue. */
      teamId: z.string().nullable(),
      /** The AI is answering it meanwhile. */
      aiActive: z.boolean(),
      unreadCount: z.number().int(),
      lastMessageAt: isoDate.nullable(),
      createdAt: isoDate,
    }),
    contact: z.object({
      id: z.string(),
      waId: z.string(),
      name: z.string().nullable(),
    }),
    /** How it got into the queue. */
    reason: z.enum(['new', 'reopened', 'returned_to_queue']),
    /** Who did it; `null` = the contact or the system. */
    actorId: z.string().nullable(),
  }),
  'agents.approval.pending': z.object({
    agent: z.object({ id: z.string(), name: z.string() }),
    runId: z.string(),
    /** Actions waiting for a decision. */
    count: z.number().int(),
  }),
} as const

export type WebhookEventType = keyof typeof WEBHOOK_DATA_SCHEMAS
export type WebhookEventData<T extends WebhookEventType> = z.infer<
  (typeof WEBHOOK_DATA_SCHEMAS)[T]
>

export interface WebhookEventDefinition {
  type: WebhookEventType
  module: WebhookEventModule
  /** pt-BR. */
  description: string
  /** `false` only for `steel.ping`: it goes to one endpoint, on demand. */
  subscribable: boolean
}

export const WEBHOOK_EVENTS: readonly WebhookEventDefinition[] = [
  {
    type: 'steel.ping',
    module: 'PLATFORM',
    description: 'Evento de teste enviado pelo botão "Enviar teste".',
    subscribable: false,
  },
  {
    type: 'servicedesk.ticket.created',
    module: 'SERVICE_DESK',
    description: 'Chamado aberto, por qualquer canal.',
    subscribable: true,
  },
  {
    type: 'servicedesk.ticket.updated',
    module: 'SERVICE_DESK',
    description: 'Chamado alterado: campos, responsável ou fase.',
    subscribable: true,
  },
  {
    type: 'servicedesk.ticket.assigned',
    module: 'SERVICE_DESK',
    description: 'Chamado atribuído a um atendente.',
    subscribable: true,
  },
  {
    type: 'servicedesk.ticket.message',
    module: 'SERVICE_DESK',
    description: 'Nova mensagem pública no chamado.',
    subscribable: true,
  },
  {
    type: 'servicedesk.ticket.resolved',
    module: 'SERVICE_DESK',
    description: 'Chamado resolvido.',
    subscribable: true,
  },
  {
    type: 'servicedesk.ticket.reopened',
    module: 'SERVICE_DESK',
    description: 'Chamado reaberto.',
    subscribable: true,
  },
  {
    type: 'servicedesk.ticket.escalated',
    module: 'SERVICE_DESK',
    description: 'Chamado escalonado por regra ou manualmente.',
    subscribable: true,
  },
  {
    type: 'servicedesk.ticket.csat',
    module: 'SERVICE_DESK',
    description: 'Solicitante avaliou o atendimento (CSAT).',
    subscribable: true,
  },
  {
    type: 'servicedesk.sla.at_risk',
    module: 'SERVICE_DESK',
    description: 'SLA do chamado em risco.',
    subscribable: true,
  },
  {
    type: 'servicedesk.sla.breached',
    module: 'SERVICE_DESK',
    description: 'SLA do chamado violado.',
    subscribable: true,
  },
  {
    type: 'servicedesk.approval.requested',
    module: 'SERVICE_DESK',
    description: 'Aprovação solicitada no chamado.',
    subscribable: true,
  },
  {
    type: 'servicedesk.approval.responded',
    module: 'SERVICE_DESK',
    description: 'Aprovação respondida (aprovada ou recusada).',
    subscribable: true,
  },
  {
    type: 'crm.lead.created',
    module: 'CRM',
    description: 'Novo lead, por qualquer canal.',
    subscribable: true,
  },
  {
    type: 'crm.opportunity.stage_changed',
    module: 'CRM',
    description: 'Oportunidade mudou de etapa no funil.',
    subscribable: true,
  },
  {
    type: 'crm.deal.won',
    module: 'CRM',
    description:
      'Negócio ganho: lead fechado como ganho ou oportunidade numa etapa de ganho.',
    subscribable: true,
  },
  {
    type: 'crm.deal.lost',
    module: 'CRM',
    description:
      'Negócio perdido: lead fechado como perdido ou oportunidade numa etapa de perda.',
    subscribable: true,
  },
  {
    type: 'communication.message.received',
    module: 'COMMUNICATION',
    description: 'Mensagem de WhatsApp recebida de um contato.',
    subscribable: true,
  },
  {
    type: 'communication.conversation.waiting',
    module: 'COMMUNICATION',
    description:
      'Conversa entrou na fila, aguardando um atendente: nova, reaberta sem responsável ou devolvida para a fila.',
    subscribable: true,
  },
  {
    type: 'agents.approval.pending',
    module: 'AGENTS',
    description: 'Um Steel Agent propôs ações que aguardam aprovação.',
    subscribable: true,
  },
]

const BY_TYPE = new Map(WEBHOOK_EVENTS.map((event) => [event.type, event]))

export function isWebhookEventType(type: string): type is WebhookEventType {
  return BY_TYPE.has(type as WebhookEventType)
}

export function webhookEventDefinition(
  type: WebhookEventType,
): WebhookEventDefinition {
  return BY_TYPE.get(type) as WebhookEventDefinition
}

/** Types an endpoint may subscribe to (the catalog minus `steel.ping`). */
export const SUBSCRIBABLE_WEBHOOK_EVENT_TYPES = WEBHOOK_EVENTS.filter(
  (event) => event.subscribable,
).map((event) => event.type)

/** Event body: `{ id, type, createdAt, workspaceId, data }`. */
export interface WebhookEventEnvelope<
  T extends WebhookEventType = WebhookEventType,
> {
  id: string
  type: T
  createdAt: string
  workspaceId: string
  data: WebhookEventData<T>
}

/** Does an endpoint subscribed to `events` receive `type`? */
export function webhookEventMatches(
  events: readonly string[],
  type: WebhookEventType,
): boolean {
  if (type === WEBHOOK_PING_EVENT) return false
  return events.includes(WEBHOOK_ALL_EVENTS) || events.includes(type)
}

/* -------------------------------- examples -------------------------------- */

const EXAMPLE_TICKET_REF = {
  id: 'cm2tkt000000example',
  number: 123,
  code: 'INC-000123',
  title: 'Impressora do financeiro sem conexão',
}

const EXAMPLE_TICKET = {
  ...EXAMPLE_TICKET_REF,
  type: 'INCIDENT' as const,
  channel: 'PORTAL',
  phase: {
    id: 'cm2phs000000example',
    name: 'Em atendimento',
    category: 'IN_PROGRESS',
  },
  priority: { id: 'cm2pri000000example', name: 'Alta' },
  departmentId: null,
  assigneeId: 'cm2usr000000example',
  requesterId: null,
  createdAt: '2026-10-18T12:00:00.000Z',
  updatedAt: '2026-10-18T12:05:00.000Z',
}

function sdExample(title: string, body: string) {
  return {
    ticket: EXAMPLE_TICKET_REF,
    actorId: 'cm2usr000000example',
    summary: { title, body },
  }
}

const EXAMPLE_DEAL = {
  source: 'opportunity' as const,
  id: 'cm2opp000000example',
  name: 'Renovação do contrato de suporte',
  amount: 12000,
  ownerId: 'cm2usr000000example',
  actorId: 'cm2usr000000example',
}

/**
 * Sample `data` of every type: used by `steel trigger` (test events) and by
 * the docs. Each one parses with its schema (covered by the unit tests).
 */
export const WEBHOOK_EVENT_EXAMPLES: {
  [T in WebhookEventType]: WebhookEventData<T>
} = {
  'steel.ping': { message: 'Teste de webhook do Steel' },
  'servicedesk.ticket.created': {
    ticket: EXAMPLE_TICKET,
    actorId: 'cm2usr000000example',
  },
  'servicedesk.ticket.updated': {
    ticket: EXAMPLE_TICKET,
    actorId: 'cm2usr000000example',
    change: 'fields',
  },
  'servicedesk.ticket.assigned': sdExample(
    'Chamado atribuído a você',
    'INC-000123 — Impressora do financeiro sem conexão',
  ),
  'servicedesk.ticket.message': sdExample(
    'Nova mensagem no chamado',
    'A impressora voltou a funcionar, obrigado!',
  ),
  'servicedesk.ticket.resolved': sdExample(
    'Chamado resolvido',
    'INC-000123 foi resolvido.',
  ),
  'servicedesk.ticket.reopened': sdExample(
    'Chamado reaberto',
    'INC-000123 foi reaberto pelo solicitante.',
  ),
  'servicedesk.ticket.escalated': sdExample(
    'Chamado escalonado',
    'INC-000123 foi escalonado para o nível 2.',
  ),
  'servicedesk.ticket.csat': sdExample('Avaliação recebida', 'Nota 5 de 5.'),
  'servicedesk.sla.at_risk': sdExample(
    'SLA em risco',
    'Faltam 30 minutos para vencer a resolução.',
  ),
  'servicedesk.sla.breached': sdExample(
    'SLA violado',
    'O prazo de resolução venceu.',
  ),
  'servicedesk.approval.requested': sdExample(
    'Aprovação solicitada',
    'A mudança aguarda a sua aprovação.',
  ),
  'servicedesk.approval.responded': sdExample(
    'Aprovação respondida',
    'A mudança foi aprovada.',
  ),
  'crm.lead.created': {
    lead: {
      id: 'cm2lead00000example',
      name: 'Maria Souza',
      emails: ['maria@example.com'],
      phones: ['+5511999990000'],
      company: 'Acme Ltda',
      source: 'site',
      channel: 'FORM',
      score: 40,
      ownerId: null,
      createdAt: '2026-10-18T12:00:00.000Z',
    },
  },
  'crm.opportunity.stage_changed': {
    opportunity: {
      id: 'cm2opp000000example',
      name: 'Renovação do contrato de suporte',
      amount: 12000,
      pipelineId: 'cm2pip000000example',
      ownerId: 'cm2usr000000example',
    },
    fromStage: {
      id: 'cm2stg00000example1',
      name: 'Proposta',
      category: 'OPEN',
    },
    toStage: {
      id: 'cm2stg00000example2',
      name: 'Negociação',
      category: 'OPEN',
    },
    actorId: 'cm2usr000000example',
  },
  'crm.deal.won': EXAMPLE_DEAL,
  'crm.deal.lost': {
    ...EXAMPLE_DEAL,
    source: 'lead',
    id: 'cm2lead00000example',
  },
  'communication.message.received': {
    message: {
      id: 'cm2msg000000example',
      conversationId: 'cm2cnv000000example',
      type: 'TEXT',
      text: 'Olá, gostaria de um orçamento.',
      providerMessageId: 'wamid.example',
      receivedAt: '2026-10-18T12:00:00.000Z',
    },
    contact: {
      id: 'cm2ctt000000example',
      waId: '5511999990000',
      name: 'Maria',
    },
    connectionId: 'cm2con000000example',
  },
  'communication.conversation.waiting': {
    conversation: {
      id: 'cm2cnv000000example',
      status: 'NEW',
      connectionId: 'cm2con000000example',
      teamId: null,
      aiActive: false,
      unreadCount: 1,
      lastMessageAt: '2026-10-18T12:00:00.000Z',
      createdAt: '2026-10-18T12:00:00.000Z',
    },
    contact: {
      id: 'cm2ctt000000example',
      waId: '5511999990000',
      name: 'Maria',
    },
    reason: 'new',
    actorId: null,
  },
  'agents.approval.pending': {
    agent: { id: 'cm2agt000000example', name: 'Triagem de leads' },
    runId: 'cm2run000000example',
    count: 2,
  },
}

/** Validates `data` against the event's schema (drops unknown keys). */
export function parseWebhookEventData<T extends WebhookEventType>(
  type: T,
  data: unknown,
): { success: true; data: WebhookEventData<T> } | { success: false } {
  const parsed = WEBHOOK_DATA_SCHEMAS[type].safeParse(data)
  return parsed.success
    ? { success: true, data: parsed.data as WebhookEventData<T> }
    : { success: false }
}
