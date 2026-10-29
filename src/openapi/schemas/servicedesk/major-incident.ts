import { z } from 'zod'
import { dto } from '../../common'
import { SdUserSummaryDTO } from '../servicedesk-tickets'

/** DTOs do incidente maior e das páginas de status (`types/sd-major-incident.d.ts`, `types/sd-status-page.d.ts`). */

const Status = z.enum(['INVESTIGATING', 'IDENTIFIED', 'MONITORING', 'RESOLVED'])
const Impact = z.enum(['DEGRADED', 'PARTIAL_OUTAGE', 'MAJOR_OUTAGE'])

export const SdMajorIncidentSummaryDTO = dto(
  'SdMajorIncidentSummary',
  z.object({
    id: z.string(),
    ticketId: z.string().meta({ description: 'Chamado principal.' }),
    ticketNumber: z.number().int(),
    ticketCode: z.string().meta({ example: 'INC-000123' }),
    title: z.string().meta({
      description: 'Texto para o cliente: aparece nas páginas públicas.',
    }),
    impact: Impact,
    status: Status,
    commander: SdUserSummaryDTO.nullable(),
    declaredAt: z.iso.datetime(),
    resolvedAt: z.iso.datetime().nullable(),
    childCount: z.number().int(),
    pageCount: z.number().int(),
  }),
)

export const SdMajorIncidentListDTO = dto(
  'SdMajorIncidentList',
  z.object({ items: z.array(SdMajorIncidentSummaryDTO) }),
)

export const SdMajorIncidentUpdateDTO = dto(
  'SdMajorIncidentUpdate',
  z.object({
    id: z.string(),
    status: Status,
    message: z.string(),
    publish: z.boolean().meta({
      description: 'Aparece nas páginas de status do incidente.',
    }),
    author: SdUserSummaryDTO.nullable(),
    createdAt: z.iso.datetime(),
    notify: z.object({
      done: z.boolean().meta({ description: 'O envio já foi processado.' }),
      total: z.number().int(),
      sent: z.number().int(),
      failed: z.number().int(),
    }),
  }),
)

export const SdMajorIncidentChildDTO = dto(
  'SdMajorIncidentChild',
  z.object({
    ticketId: z.string(),
    number: z.number().int(),
    code: z.string(),
    title: z.string(),
    phase: z.string(),
    phaseCategory: z.string(),
    source: z.enum(['MANUAL', 'SUGGESTION', 'MONITORING', 'AUTOMATION']),
    linkedAt: z.iso.datetime(),
    linkedBy: SdUserSummaryDTO.nullable(),
  }),
)

export const SdMajorIncidentDTO = dto(
  'SdMajorIncident',
  SdMajorIncidentSummaryDTO.extend({
    ticketTitle: z.string(),
    summary: z.string().nullable(),
    resolution: z
      .string()
      .nullable()
      .meta({ description: 'Nota interna do que resolveu.' }),
    declaredBy: SdUserSummaryDTO.nullable(),
    resolvedBy: SdUserSummaryDTO.nullable(),
    swarmId: z
      .string()
      .nullable()
      .meta({ description: 'Sala de guerra (swarming do chamado principal).' }),
    updates: z
      .array(SdMajorIncidentUpdateDTO)
      .meta({ description: 'Mais recentes primeiro.' }),
    children: z.array(SdMajorIncidentChildDTO),
    pages: z.array(
      z.object({ id: z.string(), name: z.string(), slug: z.string() }),
    ),
  }),
)

export const SdMajorIncidentDeclareDTO = dto(
  'SdMajorIncidentDeclare',
  z.object({
    incident: SdMajorIncidentDTO,
    warnings: z.array(z.string()).meta({
      description:
        'O que não saiu como pedido (sala de guerra, chamados filhos).',
    }),
  }),
)

export const SdTicketMajorIncidentDTO = dto(
  'SdTicketMajorIncident',
  z.object({
    master: SdMajorIncidentSummaryDTO.nullable(),
    child: SdMajorIncidentSummaryDTO.nullable(),
    canDeclare: z.boolean(),
    suggestedPageIds: z.array(z.string()),
  }),
)

export const SdMajorIncidentSuggestionListDTO = dto(
  'SdMajorIncidentSuggestionList',
  z.object({
    items: z.array(
      z.object({
        ticketId: z.string(),
        number: z.number().int(),
        code: z.string(),
        title: z.string(),
        createdAt: z.iso.datetime(),
        reasons: z.array(z.enum(['CATEGORY', 'CONFIG_ITEM', 'CUSTOMER'])),
      }),
    ),
  }),
)

export const SdMajorIncidentLinkResultDTO = dto(
  'SdMajorIncidentLinkResult',
  z.object({
    linked: z.number().int(),
    skipped: z.array(z.object({ ref: z.string(), reason: z.string() })),
  }),
)

// ----- Status pages ----------------------------------------------------------

export const SdStatusPageDTO = dto(
  'SdStatusPage',
  z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    path: z.string().meta({ example: '/status-page/acme-telefonia' }),
    description: z.string().nullable(),
    customer: z.object({ id: z.string(), name: z.string() }).nullable(),
    serviceIds: z.array(z.string()),
    services: z.array(z.object({ id: z.string(), name: z.string() })),
    published: z.boolean(),
    allowSubscriptions: z.boolean(),
    subscriberCount: z.number().int().meta({ description: 'Confirmados.' }),
    activeIncidentCount: z.number().int(),
    createdAt: z.iso.datetime(),
  }),
)

export const SdStatusPageListDTO = dto(
  'SdStatusPageList',
  z.object({ items: z.array(SdStatusPageDTO) }),
)

export const SdStatusSubscriberDTO = dto(
  'SdStatusSubscriber',
  z.object({
    id: z.string(),
    channel: z.enum(['EMAIL', 'WHATSAPP']),
    address: z.string(),
    name: z.string().nullable(),
    confirmed: z.boolean(),
    createdAt: z.iso.datetime(),
  }),
)

export const SdStatusSubscriberListDTO = dto(
  'SdStatusSubscriberList',
  z.object({ items: z.array(SdStatusSubscriberDTO) }),
)

const PublicIncident = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string().nullable(),
  impact: Impact,
  status: Status,
  startedAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().nullable(),
  updates: z.array(
    z.object({ status: Status, message: z.string(), at: z.iso.datetime() }),
  ),
})

export const SdPublicStatusPageDTO = dto(
  'SdPublicStatusPage',
  z.object({
    name: z.string(),
    description: z.string().nullable(),
    workspaceName: z.string(),
    timeZone: z.string().meta({ example: 'America/Sao_Paulo' }),
    overall: z.enum([
      'OPERATIONAL',
      'DEGRADED',
      'PARTIAL_OUTAGE',
      'MAJOR_OUTAGE',
    ]),
    services: z.array(z.string()),
    allowSubscriptions: z.boolean(),
    active: z.array(PublicIncident),
    recent: z.array(PublicIncident).meta({
      description:
        'Resolvidos nos últimos 30 dias, do mais recente ao mais antigo.',
    }),
  }),
)

export const SdStatusSubscriptionDTO = dto(
  'SdStatusSubscription',
  z.object({
    pageName: z.string(),
    pageSlug: z.string(),
    channel: z.enum(['EMAIL', 'WHATSAPP']),
    addressMasked: z.string().meta({ example: 'j***@acme.com.br' }),
    confirmed: z.boolean(),
    unsubscribed: z.boolean(),
  }),
)
