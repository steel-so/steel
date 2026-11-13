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

/* Cadastros, base de conhecimento e documentos (API v1 + webhooks). */

const nullableIso = isoDate.nullable()

const CrmPersonSnapshotSchema = z.object({
  id: z.string(),
  name: z.string(),
  emails: z.array(z.string()),
  phones: z.array(z.string()),
  city: z.string().nullable(),
  jobTitle: z.string().nullable(),
  companyId: z.string().nullable(),
  createdAt: isoDate,
  updatedAt: isoDate,
})

const CrmCompanySnapshotSchema = z.object({
  id: z.string(),
  name: z.string(),
  cnpj: z.string().nullable(),
  domain: z.string().nullable(),
  employees: z.number().nullable(),
  arr: z.number().nullable(),
  icp: z.boolean(),
  accountOwnerId: z.string().nullable(),
  createdAt: isoDate,
  updatedAt: isoDate,
})

const DocumentRefSchema = z.object({
  id: z.string(),
  title: z.string(),
  ownerId: z.string().nullable(),
})

const DocumentSnapshotSchema = DocumentRefSchema.extend({
  kind: z.string(),
  status: z.string(),
  isTemplate: z.boolean(),
  companyId: z.string().nullable(),
  personId: z.string().nullable(),
  opportunityId: z.string().nullable(),
  leadId: z.string().nullable(),
  totalValue: z.number().nullable(),
  validUntil: nullableIso,
  sentAt: nullableIso,
  acceptedAt: nullableIso,
  createdAt: isoDate,
  updatedAt: isoDate,
})

const DocumentAnsweredSchema = z.object({
  document: DocumentRefSchema,
  /** Who answered through the public link. */
  reader: z.object({
    name: z.string().nullable(),
    email: z.string().nullable(),
  }),
  /** Decline reason; `null` on accept. */
  reason: z.string().nullable(),
})

const SdCustomerSnapshotSchema = z.object({
  id: z.string(),
  kind: z.enum(['CLIENT', 'COMPANY']),
  personType: z.enum(['INDIVIDUAL', 'LEGAL']),
  name: z.string(),
  tradeName: z.string().nullable(),
  document: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  whatsapp: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  active: z.boolean(),
  createdAt: isoDate,
  updatedAt: isoDate,
})

const SdContactSnapshotSchema = z.object({
  id: z.string(),
  name: z.string(),
  jobTitle: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  whatsapp: z.string().nullable(),
  userId: z.string().nullable(),
  active: z.boolean(),
  /** Linked customers/companies, primary first. */
  customerIds: z.array(z.string()),
  createdAt: isoDate,
  updatedAt: isoDate,
})

const SdKbArticleSnapshotSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(['DRAFT', 'IN_REVIEW', 'PUBLISHED']),
  visibility: z.enum(['INTERNAL', 'PORTAL']),
  parentId: z.string().nullable(),
  categoryId: z.string().nullable(),
  tags: z.array(z.string()),
  sourceTicketId: z.string().nullable(),
  publishedAt: nullableIso,
  createdAt: isoDate,
  updatedAt: isoDate,
})

const actor = { actorId: z.string().nullable() }
const personEvent = z.object({ person: CrmPersonSnapshotSchema, ...actor })
const companyEvent = z.object({ company: CrmCompanySnapshotSchema, ...actor })
const documentEvent = z.object({ document: DocumentSnapshotSchema, ...actor })
const customerEvent = z.object({ customer: SdCustomerSnapshotSchema, ...actor })
const contactEvent = z.object({ contact: SdContactSnapshotSchema, ...actor })
const kbArticleEvent = z.object({
  article: SdKbArticleSnapshotSchema,
  ...actor,
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
  'crm.person.created': personEvent,
  'crm.person.updated': personEvent,
  'crm.person.deleted': personEvent,
  'crm.company.created': companyEvent,
  'crm.company.updated': companyEvent,
  'crm.company.deleted': companyEvent,
  'crm.document.created': documentEvent,
  'crm.document.updated': documentEvent,
  'crm.document.deleted': documentEvent,
  'crm.document.sent': documentEvent.extend({
    recipients: z.number().int(),
  }),
  'crm.document.accepted': DocumentAnsweredSchema,
  'crm.document.declined': DocumentAnsweredSchema,
  'servicedesk.customer.created': customerEvent,
  'servicedesk.customer.updated': customerEvent,
  'servicedesk.customer.deleted': customerEvent,
  'servicedesk.contact.created': contactEvent,
  'servicedesk.contact.updated': contactEvent,
  'servicedesk.contact.deleted': contactEvent,
  'servicedesk.kb_article.created': kbArticleEvent,
  'servicedesk.kb_article.updated': kbArticleEvent,
  'servicedesk.kb_article.published': kbArticleEvent,
  'servicedesk.kb_article.unpublished': kbArticleEvent,
  'servicedesk.kb_article.deleted': kbArticleEvent,
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
  {
    type: 'crm.person.created',
    module: 'CRM',
    description: 'Pessoa cadastrada no CRM, por qualquer canal.',
    subscribable: true,
  },
  {
    type: 'crm.person.updated',
    module: 'CRM',
    description: 'Pessoa do CRM alterada.',
    subscribable: true,
  },
  {
    type: 'crm.person.deleted',
    module: 'CRM',
    description: 'Pessoa do CRM excluída.',
    subscribable: true,
  },
  {
    type: 'crm.company.created',
    module: 'CRM',
    description: 'Empresa cadastrada no CRM, por qualquer canal.',
    subscribable: true,
  },
  {
    type: 'crm.company.updated',
    module: 'CRM',
    description: 'Empresa do CRM alterada.',
    subscribable: true,
  },
  {
    type: 'crm.company.deleted',
    module: 'CRM',
    description: 'Empresa do CRM excluída.',
    subscribable: true,
  },
  {
    type: 'crm.document.created',
    module: 'CRM',
    description: 'Documento criado (proposta, contrato, orçamento...).',
    subscribable: true,
  },
  {
    type: 'crm.document.updated',
    module: 'CRM',
    description: 'Documento alterado: dados, vínculos ou status.',
    subscribable: true,
  },
  {
    type: 'crm.document.deleted',
    module: 'CRM',
    description: 'Documento excluído.',
    subscribable: true,
  },
  {
    type: 'crm.document.sent',
    module: 'CRM',
    description: 'Documento enviado a um ou mais destinatários.',
    subscribable: true,
  },
  {
    type: 'crm.document.accepted',
    module: 'CRM',
    description: 'Documento aceito pelo leitor do link público.',
    subscribable: true,
  },
  {
    type: 'crm.document.declined',
    module: 'CRM',
    description: 'Documento recusado pelo leitor do link público.',
    subscribable: true,
  },
  {
    type: 'servicedesk.customer.created',
    module: 'SERVICE_DESK',
    description: 'Cliente ou empresa cadastrado no ServiceDesk.',
    subscribable: true,
  },
  {
    type: 'servicedesk.customer.updated',
    module: 'SERVICE_DESK',
    description: 'Cliente ou empresa do ServiceDesk alterado.',
    subscribable: true,
  },
  {
    type: 'servicedesk.customer.deleted',
    module: 'SERVICE_DESK',
    description: 'Cliente ou empresa do ServiceDesk excluído.',
    subscribable: true,
  },
  {
    type: 'servicedesk.contact.created',
    module: 'SERVICE_DESK',
    description: 'Contato cadastrado no ServiceDesk.',
    subscribable: true,
  },
  {
    type: 'servicedesk.contact.updated',
    module: 'SERVICE_DESK',
    description: 'Contato do ServiceDesk alterado.',
    subscribable: true,
  },
  {
    type: 'servicedesk.contact.deleted',
    module: 'SERVICE_DESK',
    description: 'Contato do ServiceDesk excluído.',
    subscribable: true,
  },
  {
    type: 'servicedesk.kb_article.created',
    module: 'SERVICE_DESK',
    description: 'Artigo criado na base de conhecimento.',
    subscribable: true,
  },
  {
    type: 'servicedesk.kb_article.updated',
    module: 'SERVICE_DESK',
    description:
      'Artigo da base de conhecimento alterado (título, categoria, visibilidade, tags ou conteúdo).',
    subscribable: true,
  },
  {
    type: 'servicedesk.kb_article.published',
    module: 'SERVICE_DESK',
    description: 'Artigo da base de conhecimento publicado.',
    subscribable: true,
  },
  {
    type: 'servicedesk.kb_article.unpublished',
    module: 'SERVICE_DESK',
    description:
      'Artigo da base de conhecimento voltou para rascunho ou revisão.',
    subscribable: true,
  },
  {
    type: 'servicedesk.kb_article.deleted',
    module: 'SERVICE_DESK',
    description: 'Artigo da base de conhecimento excluído.',
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

const EXAMPLE_TS = {
  createdAt: '2026-10-18T12:00:00.000Z',
  updatedAt: '2026-10-18T12:05:00.000Z',
}
const EXAMPLE_ACTOR = 'cm2usr000000example'

const EXAMPLE_PERSON = {
  id: 'cm2per000000example',
  name: 'Maria Souza',
  emails: ['maria@example.com'],
  phones: ['+5511999990000'],
  city: 'São Paulo',
  jobTitle: 'Gerente de TI',
  companyId: 'cm2cmp000000example',
  ...EXAMPLE_TS,
}

const EXAMPLE_COMPANY = {
  id: 'cm2cmp000000example',
  name: 'Acme Ltda',
  cnpj: '12345678000190',
  domain: 'acme.com.br',
  employees: 120,
  arr: 240000,
  icp: true,
  accountOwnerId: EXAMPLE_ACTOR,
  ...EXAMPLE_TS,
}

const EXAMPLE_DOCUMENT = {
  id: 'cm2doc000000example',
  title: 'Proposta comercial - Acme',
  ownerId: EXAMPLE_ACTOR,
  kind: 'PROPOSAL',
  status: 'DRAFT',
  isTemplate: false,
  companyId: 'cm2cmp000000example',
  personId: null,
  opportunityId: 'cm2opp000000example',
  leadId: null,
  totalValue: 12000,
  validUntil: '2026-11-18T12:00:00.000Z',
  sentAt: null,
  acceptedAt: null,
  ...EXAMPLE_TS,
}

const EXAMPLE_DOCUMENT_ANSWERED = {
  document: {
    id: EXAMPLE_DOCUMENT.id,
    title: EXAMPLE_DOCUMENT.title,
    ownerId: EXAMPLE_ACTOR,
  },
  reader: { name: 'Maria Souza', email: 'maria@example.com' },
}

const EXAMPLE_CUSTOMER = {
  id: 'cm2cus000000example',
  kind: 'COMPANY' as const,
  personType: 'LEGAL' as const,
  name: 'Acme Ltda',
  tradeName: 'Acme',
  document: '12345678000190',
  email: 'contato@acme.com.br',
  phone: '1130000000',
  whatsapp: '5511999990000',
  city: 'São Paulo',
  state: 'SP',
  active: true,
  ...EXAMPLE_TS,
}

const EXAMPLE_SD_CONTACT = {
  id: 'cm2sct000000example',
  name: 'Carlos Lima',
  jobTitle: 'Analista de TI',
  email: 'carlos@acme.com.br',
  phone: null,
  whatsapp: '5511988887777',
  userId: null,
  active: true,
  customerIds: ['cm2cus000000example'],
  ...EXAMPLE_TS,
}

const EXAMPLE_KB_ARTICLE = {
  id: 'cm2kba000000example',
  title: 'Como redefinir a senha da VPN',
  status: 'PUBLISHED' as const,
  visibility: 'PORTAL' as const,
  parentId: null,
  categoryId: null,
  tags: ['vpn', 'acesso'],
  sourceTicketId: null,
  publishedAt: '2026-10-18T12:05:00.000Z',
  ...EXAMPLE_TS,
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
  'crm.person.created': { person: EXAMPLE_PERSON, actorId: EXAMPLE_ACTOR },
  'crm.person.updated': { person: EXAMPLE_PERSON, actorId: EXAMPLE_ACTOR },
  'crm.person.deleted': { person: EXAMPLE_PERSON, actorId: EXAMPLE_ACTOR },
  'crm.company.created': { company: EXAMPLE_COMPANY, actorId: EXAMPLE_ACTOR },
  'crm.company.updated': { company: EXAMPLE_COMPANY, actorId: EXAMPLE_ACTOR },
  'crm.company.deleted': { company: EXAMPLE_COMPANY, actorId: EXAMPLE_ACTOR },
  'crm.document.created': {
    document: EXAMPLE_DOCUMENT,
    actorId: EXAMPLE_ACTOR,
  },
  'crm.document.updated': {
    document: EXAMPLE_DOCUMENT,
    actorId: EXAMPLE_ACTOR,
  },
  'crm.document.deleted': {
    document: EXAMPLE_DOCUMENT,
    actorId: EXAMPLE_ACTOR,
  },
  'crm.document.sent': {
    document: {
      ...EXAMPLE_DOCUMENT,
      status: 'SENT',
      sentAt: '2026-10-18T12:05:00.000Z',
    },
    actorId: EXAMPLE_ACTOR,
    recipients: 1,
  },
  'crm.document.accepted': { ...EXAMPLE_DOCUMENT_ANSWERED, reason: null },
  'crm.document.declined': {
    ...EXAMPLE_DOCUMENT_ANSWERED,
    reason: 'Fora do orçamento deste trimestre.',
  },
  'servicedesk.customer.created': {
    customer: EXAMPLE_CUSTOMER,
    actorId: EXAMPLE_ACTOR,
  },
  'servicedesk.customer.updated': {
    customer: EXAMPLE_CUSTOMER,
    actorId: EXAMPLE_ACTOR,
  },
  'servicedesk.customer.deleted': {
    customer: EXAMPLE_CUSTOMER,
    actorId: EXAMPLE_ACTOR,
  },
  'servicedesk.contact.created': {
    contact: EXAMPLE_SD_CONTACT,
    actorId: EXAMPLE_ACTOR,
  },
  'servicedesk.contact.updated': {
    contact: EXAMPLE_SD_CONTACT,
    actorId: EXAMPLE_ACTOR,
  },
  'servicedesk.contact.deleted': {
    contact: EXAMPLE_SD_CONTACT,
    actorId: EXAMPLE_ACTOR,
  },
  'servicedesk.kb_article.created': {
    article: { ...EXAMPLE_KB_ARTICLE, status: 'DRAFT', publishedAt: null },
    actorId: EXAMPLE_ACTOR,
  },
  'servicedesk.kb_article.updated': {
    article: EXAMPLE_KB_ARTICLE,
    actorId: EXAMPLE_ACTOR,
  },
  'servicedesk.kb_article.published': {
    article: EXAMPLE_KB_ARTICLE,
    actorId: EXAMPLE_ACTOR,
  },
  'servicedesk.kb_article.unpublished': {
    article: { ...EXAMPLE_KB_ARTICLE, status: 'DRAFT', publishedAt: null },
    actorId: EXAMPLE_ACTOR,
  },
  'servicedesk.kb_article.deleted': {
    article: EXAMPLE_KB_ARTICLE,
    actorId: EXAMPLE_ACTOR,
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
