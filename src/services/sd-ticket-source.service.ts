import type { SdTicketChannel } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import {
  sdTicketSourceHasOpenTicket,
  sdTicketSourceNotFound,
} from '@/src/errors/app-error'
import { phoneMatchKey, waIdCandidates } from '@/src/lib/pabx/recording'
import { toDisplayPhone } from '@/src/lib/phone-br'
import { err, ok, type Result } from '@/src/lib/result'
import {
  buildSourceDescriptionHtml,
  buildSourceDescriptionText,
  buildSourceTitle,
  type SourceDetail,
  type SourceMessageLine,
  toSourceMessageLine,
} from '@/src/lib/servicedesk/ticket-source'
import { normalizeSdWhatsappNumber } from '@/src/lib/servicedesk/whatsapp'
import { toSdTicketSourceLinkDTO } from '@/src/mappers/sd-ticket-source.mapper'
import { CrmActivityRepository } from '@/src/repositories/crm-activity.repository'
import { CrmLeadRepository } from '@/src/repositories/crm-lead.repository'
import { CrmOpportunityRepository } from '@/src/repositories/crm-opportunity.repository'
import { CrmPersonRepository } from '@/src/repositories/crm-person.repository'
import { PhoneCallLinkRepository } from '@/src/repositories/phone-call-link.repository'
import { SdContactRepository } from '@/src/repositories/sd-contact.repository'
import { SdCustomerRepository } from '@/src/repositories/sd-customer.repository'
import {
  SdTicketSourceRepository,
  type SourceConversationRow,
  type SourceLinks,
} from '@/src/repositories/sd-ticket-source.repository'
import type {
  CreateSdTicketFromSourceDTO,
  SdTicketSourceKind,
  SdTicketSourceQueryDTO,
} from '@/src/schemas/sd-ticket-source.schema'
import type {
  SdTicketSourceCreatedDTO,
  SdTicketSourceLinkDTO,
  SdTicketSourcePrefillDTO,
} from '@/types/sd-ticket-source'
import { assertModuleEnabled, assertModuleMember } from './authz'
import { SdAccess } from './sd-access'
import { SdTicketService } from './sd-ticket.service'
import { SdTicketEngine } from './sd-ticket-engine'
import { recordSdTicketEvent } from './sd-ticket-event-recorder'
import { loadConversationForViewer } from './whatsapp-conversation-scope.service'

/**
 * Opens a ServiceDesk ticket from a Comunicação conversation or from a CRM
 * lead, person or opportunity, and links both ways:
 *
 * - ticket -> source: `SdTicket.whatsappConversationId` / `crmLeadId` /
 *   `crmPersonId` / `crmOpportunityId`;
 * - source -> ticket: `listBySource` (zap banner, CRM record panels) and a
 *   `CrmActivity` row on the person / opportunity / company timeline.
 *
 * Authorization: a ServiceDesk agent with CREATE on tickets AND view access to
 * the source (CRM permission on the record, or the zap conversation as the
 * viewer's team scope allows). The ticket goes through `SdTicketService.create`,
 * so catalog, SLA, routing, automations and the customer-facing "chamado
 * criado" notification behave exactly as for any other ticket.
 *
 * Connections: the zap inbox uses `COMMUNICATION` connections and the
 * ServiceDesk its own `SERVICE_DESK` one. A conversation of either is linked
 * as is (no copy, no new conversation); for a `COMMUNICATION` one the ticket's
 * WhatsApp tab reads and answers it through that same connection, and the
 * customer's later messages stay in the zap inbox instead of being mirrored
 * into the ticket history. See `docs/servicedesk/README.md`.
 */

const TIMEZONE = 'America/Sao_Paulo'
const PREVIEW_MESSAGES = 10
const MAX_LISTED = 20

const SD_CREATE = { resource: 'sd-tickets', action: 'CREATE' } as const
const SD_VIEW = { resource: 'sd-tickets', action: 'VIEW' } as const

interface ResolvedSource {
  kind: SdTicketSourceKind
  id: string
  label: string
  phones: string[]
  emails: string[]
  companyName: string | null
  companyCnpj: string | null
  details: SourceDetail[]
  messages: SourceMessageLine[]
  lastCustomerText: string | null
  channel: SdTicketChannel
  links: SourceLinks
  /** Ids of the CRM timeline the activity row is written to. */
  activity: { companyId?: string; personId?: string; opportunityId?: string }
  connectionNote: string | null
}

function digits(value: string): string {
  return value.replace(/\D/g, '')
}

/** Phone variants a ServiceDesk contact may have stored the number as. */
function phoneCandidates(phones: string[]): string[] {
  const out = new Set<string>()
  for (const phone of phones) {
    const normalized = normalizeSdWhatsappNumber(phone)
    if (normalized) out.add(normalized)
    for (const candidate of waIdCandidates(phone)) out.add(candidate)
  }
  return [...out]
}

function phoneDetail(phones: string[]): SourceDetail[] {
  const shown = phones.map((p) => toDisplayPhone(p)).filter(Boolean)
  if (shown.length === 0) return []
  const label = shown.length > 1 ? 'Telefones' : 'Telefone'
  return [{ label, value: shown.join(', ') }]
}

function emailDetail(emails: string[]): SourceDetail[] {
  if (emails.length === 0) return []
  const label = emails.length > 1 ? 'E-mails' : 'E-mail'
  return [{ label, value: emails.join(', ') }]
}

function companyDetail(name: string | null): SourceDetail[] {
  return name ? [{ label: 'Empresa', value: name }] : []
}

/** Best-effort CRM person (and company) behind a phone, only when CRM is on. */
async function crmPersonByPhone(
  workspaceId: string,
  phone: string,
): Promise<string | null> {
  const enabled = await assertModuleEnabled(workspaceId, 'CRM')
  if (!enabled.ok) return null
  const key = phoneMatchKey(phone)
  if (!key) return null
  const found = await PhoneCallLinkRepository.findPersonByPhoneKey(
    workspaceId,
    key,
  )
  return found.ok ? found.value : null
}

async function loadConversation(
  actorId: string,
  workspaceId: string,
  conversationId: string,
  messageCount: number,
): Promise<Result<ResolvedSource>> {
  const found = await SdTicketSourceRepository.findConversation(
    workspaceId,
    conversationId,
  )
  if (!found.ok) return found
  const conversation: SourceConversationRow | null = found.value
  if (!conversation) return err(sdTicketSourceNotFound())

  if (conversation.connection.module === 'COMMUNICATION') {
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'conversations', action: 'VIEW' },
    )
    if (!membership.ok) return membership
    const visible = await loadConversationForViewer(
      { userId: actorId, role: membership.value.role },
      workspaceId,
      conversation.id,
    )
    // Same answer as a missing one: the conversation is not revealed.
    if (!visible.ok) return err(sdTicketSourceNotFound())
  } else if (conversation.connection.module !== 'SERVICE_DESK') {
    return err(sdTicketSourceNotFound())
  }

  let messages: SourceMessageLine[] = []
  let lastCustomerText: string | null = null
  const recent = await SdTicketSourceRepository.listRecentMessages(
    conversation.id,
    Math.max(messageCount, 1),
    conversation.clearedAt,
  )
  if (!recent.ok) return recent
  const lines: { line: SourceMessageLine; incoming: boolean }[] = []
  for (const message of recent.value) {
    const line = toSourceMessageLine(message)
    if (line) lines.push({ line, incoming: message.direction === 'IN' })
  }
  if (messageCount > 0) messages = lines.map((m) => m.line)
  for (const m of [...lines].reverse()) {
    if (m.incoming) {
      // A media placeholder ("[imagem]") makes a poor title.
      lastCustomerText = m.line.text.startsWith('[') ? null : m.line.text
      break
    }
  }

  const waId = conversation.contact.waId
  const phones = /^\d{8,15}$/.test(waId) ? [waId] : []
  const label =
    conversation.contact.name?.trim() ||
    (phones[0] ? toDisplayPhone(phones[0]) : 'Contato sem nome')
  const crmPersonId = phones[0]
    ? await crmPersonByPhone(workspaceId, phones[0])
    : null

  return ok({
    kind: 'conversation',
    id: conversation.id,
    label,
    phones,
    emails: [],
    companyName: null,
    companyCnpj: null,
    details: phoneDetail(phones),
    messages,
    lastCustomerText,
    channel: 'WHATSAPP',
    links: {
      whatsappConversationId: conversation.id,
      ...(crmPersonId ? { crmPersonId } : {}),
    },
    activity: crmPersonId ? { personId: crmPersonId } : {},
    connectionNote:
      conversation.connection.module === 'COMMUNICATION'
        ? 'Esta conversa é do WhatsApp de Comunicação. O chamado fica ligado a ela: você vê e responde pela aba WhatsApp do chamado, e as próximas mensagens do cliente continuam chegando na Comunicação.'
        : null,
  })
}

async function loadLead(
  actorId: string,
  workspaceId: string,
  leadId: string,
): Promise<Result<ResolvedSource>> {
  const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
    resource: 'leads',
    action: 'VIEW',
  })
  if (!membership.ok) return membership
  const lead = await CrmLeadRepository.findById(leadId, workspaceId)
  if (!lead.ok) return lead
  const l = lead.value
  const details: SourceDetail[] = [
    ...companyDetail(l.company),
    ...(l.jobTitle ? [{ label: 'Cargo', value: l.jobTitle }] : []),
    ...phoneDetail(l.phones),
    ...emailDetail(l.emails),
  ]
  return ok({
    kind: 'lead',
    id: l.id,
    label: l.name,
    phones: l.phones,
    emails: l.emails,
    companyName: l.company,
    companyCnpj: null,
    details,
    messages: [],
    lastCustomerText: null,
    channel: 'AGENT',
    links: {
      crmLeadId: l.id,
      ...(l.convertedPersonId ? { crmPersonId: l.convertedPersonId } : {}),
    },
    activity: l.convertedPersonId ? { personId: l.convertedPersonId } : {},
    connectionNote: null,
  })
}

async function loadPerson(
  actorId: string,
  workspaceId: string,
  personId: string,
): Promise<Result<ResolvedSource>> {
  const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
    resource: 'people',
    action: 'VIEW',
  })
  if (!membership.ok) return membership
  const person = await CrmPersonRepository.findById(personId, workspaceId)
  if (!person.ok) return person
  const p = person.value
  const company = p.companyId
    ? await SdTicketSourceRepository.findCrmCompany(workspaceId, p.companyId)
    : null
  if (company && !company.ok) return company
  const companyRow = company?.ok ? company.value : null
  return ok({
    kind: 'person',
    id: p.id,
    label: p.name,
    phones: p.phones,
    emails: p.emails,
    companyName: companyRow?.name ?? null,
    companyCnpj: companyRow?.cnpj ?? null,
    details: [
      ...companyDetail(companyRow?.name ?? null),
      ...(p.jobTitle ? [{ label: 'Cargo', value: p.jobTitle }] : []),
      ...phoneDetail(p.phones),
      ...emailDetail(p.emails),
    ],
    messages: [],
    lastCustomerText: null,
    channel: 'AGENT',
    links: { crmPersonId: p.id },
    activity: {
      personId: p.id,
      ...(companyRow ? { companyId: companyRow.id } : {}),
    },
    connectionNote: null,
  })
}

async function loadOpportunity(
  actorId: string,
  workspaceId: string,
  opportunityId: string,
): Promise<Result<ResolvedSource>> {
  const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
    resource: 'opportunities',
    action: 'VIEW',
  })
  if (!membership.ok) return membership
  const opportunity = await CrmOpportunityRepository.findById(
    opportunityId,
    workspaceId,
  )
  if (!opportunity.ok) return opportunity
  const o = opportunity.value

  const contact = o.pointOfContactId
    ? await CrmPersonRepository.findById(o.pointOfContactId, workspaceId)
    : null
  const contactRow = contact?.ok ? contact.value : null
  const company = o.companyId
    ? await SdTicketSourceRepository.findCrmCompany(workspaceId, o.companyId)
    : null
  if (company && !company.ok) return company
  const companyRow = company?.ok ? company.value : null

  const phones = contactRow?.phones ?? []
  const emails = contactRow?.emails ?? []
  return ok({
    kind: 'opportunity',
    id: o.id,
    label: o.name,
    phones,
    emails,
    companyName: companyRow?.name ?? null,
    companyCnpj: companyRow?.cnpj ?? null,
    details: [
      ...companyDetail(companyRow?.name ?? null),
      ...(contactRow ? [{ label: 'Contato', value: contactRow.name }] : []),
      ...phoneDetail(phones),
      ...emailDetail(emails),
    ],
    messages: [],
    lastCustomerText: null,
    channel: 'AGENT',
    links: {
      crmOpportunityId: o.id,
      ...(contactRow ? { crmPersonId: contactRow.id } : {}),
    },
    activity: {
      opportunityId: o.id,
      ...(contactRow ? { personId: contactRow.id } : {}),
      ...(companyRow ? { companyId: companyRow.id } : {}),
    },
    connectionNote: null,
  })
}

async function loadSource(
  actorId: string,
  workspaceId: string,
  kind: SdTicketSourceKind,
  sourceId: string,
  messageCount: number,
): Promise<Result<ResolvedSource>> {
  switch (kind) {
    case 'conversation':
      return loadConversation(actorId, workspaceId, sourceId, messageCount)
    case 'lead':
      return loadLead(actorId, workspaceId, sourceId)
    case 'person':
      return loadPerson(actorId, workspaceId, sourceId)
    case 'opportunity':
      return loadOpportunity(actorId, workspaceId, sourceId)
  }
}

interface RequesterMatch {
  contact: { id: string; name: string } | null
  customer: { id: string; name: string } | null
}

/**
 * Matches the source to the ServiceDesk registers: the contact by phone or
 * e-mail, then the customer by the contact's own link, the company CNPJ or the
 * exact company name. No match is fine: the description carries the details.
 */
async function matchRequester(
  workspaceId: string,
  source: ResolvedSource,
): Promise<Result<RequesterMatch>> {
  let contact: RequesterMatch['contact'] = null
  let customer: RequesterMatch['customer'] = null

  const whatsapp = phoneCandidates(source.phones)
  const emails = source.emails.length > 0 ? source.emails : [undefined]
  for (const email of emails) {
    if (whatsapp.length === 0 && !email) continue
    const found = await SdContactRepository.findByChannel(workspaceId, {
      whatsapp,
      email,
    })
    if (!found.ok) return found
    if (found.value) {
      contact = { id: found.value.id, name: found.value.name }
      const primary = found.value.customers[0]?.customer
      if (primary) customer = { id: primary.id, name: primary.name }
      break
    }
  }

  if (!customer && source.companyCnpj) {
    const doc = digits(source.companyCnpj)
    if (doc) {
      const byDocument = await SdCustomerRepository.findByDocument(
        workspaceId,
        doc,
      )
      if (!byDocument.ok) return byDocument
      if (byDocument.value) {
        customer = { id: byDocument.value.id, name: byDocument.value.name }
      }
    }
  }
  if (!customer && source.companyName) {
    const byName = await SdTicketSourceRepository.findCustomerByName(
      workspaceId,
      source.companyName,
    )
    if (!byName.ok) return byName
    customer = byName.value
  }
  return ok({ contact, customer })
}

async function context(workspaceId: string) {
  const [config, workspace] = await Promise.all([
    SdTicketEngine.loadConfig(workspaceId),
    SdTicketSourceRepository.findWorkspaceMeta(workspaceId),
  ])
  if (!config.ok) return config
  if (!workspace.ok) return workspace
  if (!workspace.value) return err(sdTicketSourceNotFound())
  return ok({ prefixes: config.value.prefixes, slug: workspace.value.slug })
}

async function listLinks(
  workspaceId: string,
  kind: SdTicketSourceKind,
  sourceId: string,
): Promise<Result<SdTicketSourceLinkDTO[]>> {
  const [rows, ctx] = await Promise.all([
    SdTicketSourceRepository.listBySource(
      workspaceId,
      kind,
      sourceId,
      MAX_LISTED,
    ),
    context(workspaceId),
  ])
  if (!rows.ok) return rows
  if (!ctx.ok) return ctx
  return ok(rows.value.map((row) => toSdTicketSourceLinkDTO(row, ctx.value)))
}

function descriptionInput(
  source: ResolvedSource,
  note: string | null | undefined,
) {
  return {
    source: source.kind,
    sourceLabel: source.label,
    details: source.details,
    note,
    messages: source.messages,
    timeZone: TIMEZONE,
  }
}

/** Trace, audit and CRM timeline of a freshly linked ticket. Never throws. */
async function afterLinked(
  actorId: string,
  workspaceId: string,
  ticket: { id: string; code: string; title: string },
  source: ResolvedSource,
): Promise<void> {
  await recordSdTicketEvent({
    workspaceId,
    ticketId: ticket.id,
    actorKind: 'AGENT',
    actorUserId: actorId,
    action: source.links.whatsappConversationId
      ? 'whatsapp.linked'
      : 'crm.linked',
    toValue: { id: source.id, label: source.label },
    meta: { source: source.kind },
  })
  auditMutation({
    entity: 'sd_ticket',
    action: 'link',
    actorId,
    targetId: ticket.id,
    meta: { workspaceId, source: source.kind, sourceId: source.id },
  })
  const { companyId, personId, opportunityId } = source.activity
  if (companyId || personId || opportunityId) {
    const recorded = await CrmActivityRepository.record({
      workspaceId,
      actorUserId: actorId,
      action: 'SD_TICKET_CREATED',
      entity: 'sd_ticket',
      entityId: ticket.id,
      companyId,
      personId,
      opportunityId,
      summary: `abriu o chamado ${ticket.code} no ServiceDesk: ${ticket.title}`,
    })
    if (!recorded.ok) {
      logger.warn('servicedesk.ticket_source.timeline_failed', {
        workspaceId,
        ticketId: ticket.id,
        reason: recorded.error.code,
      })
    }
  }
}

export const SdTicketSourceService = {
  /** What the dialog shows: title, description preview, match and open tickets. */
  async preview(
    actorId: string,
    workspaceId: string,
    query: SdTicketSourceQueryDTO,
  ): Promise<Result<SdTicketSourcePrefillDTO>> {
    const access = await SdAccess.requireAgent(actorId, workspaceId, SD_CREATE)
    if (!access.ok) return access
    const source = await loadSource(
      actorId,
      workspaceId,
      query.source,
      query.sourceId,
      PREVIEW_MESSAGES,
    )
    if (!source.ok) return source
    const [match, linked] = await Promise.all([
      matchRequester(workspaceId, source.value),
      listLinks(workspaceId, query.source, query.sourceId),
    ])
    if (!match.ok) return match
    if (!linked.ok) return linked

    const s = source.value
    return ok({
      source: s.kind,
      sourceId: s.id,
      sourceLabel: s.label,
      title: buildSourceTitle({
        source: s.kind,
        label: s.label,
        lastCustomerText: s.lastCustomerText,
      }),
      descriptionPreview: buildSourceDescriptionText(descriptionInput(s, null)),
      messageCount: s.messages.length,
      requester: {
        name: s.label,
        phone: s.phones[0] ? toDisplayPhone(s.phones[0]) : null,
        email: s.emails[0] ?? null,
      },
      contact: match.value.contact,
      customer: match.value.customer,
      openTickets: linked.value.filter((t) => t.open),
      connectionNote: s.connectionNote,
    })
  },

  /** Tickets linked to a conversation or CRM record (agents only). */
  async listBySource(
    actorId: string,
    workspaceId: string,
    query: SdTicketSourceQueryDTO,
  ): Promise<Result<SdTicketSourceLinkDTO[]>> {
    const access = await SdAccess.requireAgent(actorId, workspaceId, SD_VIEW)
    if (!access.ok) return access
    return listLinks(workspaceId, query.source, query.sourceId)
  },

  async create(
    actorId: string,
    workspaceId: string,
    dto: CreateSdTicketFromSourceDTO,
  ): Promise<Result<SdTicketSourceCreatedDTO>> {
    const access = await SdAccess.requireAgent(actorId, workspaceId, SD_CREATE)
    if (!access.ok) return access

    const messageCount = dto.includeMessages ? dto.messageCount : 0
    const source = await loadSource(
      actorId,
      workspaceId,
      dto.source,
      dto.sourceId,
      Math.max(messageCount, 1),
    )
    if (!source.ok) return source
    const s: ResolvedSource = {
      ...source.value,
      messages: messageCount > 0 ? source.value.messages : [],
    }

    const existing = await listLinks(workspaceId, dto.source, dto.sourceId)
    if (!existing.ok) return existing
    const open = existing.value.filter((t) => t.open)
    if (open.length > 0 && !dto.allowDuplicate) {
      return err(
        sdTicketSourceHasOpenTicket(
          `Já existe o chamado ${open[0].code} em aberto para esta origem. Abra-o ou confirme para criar outro.`,
        ),
      )
    }

    const match = await matchRequester(workspaceId, s)
    if (!match.ok) return match

    const created = await SdTicketService.create(actorId, workspaceId, {
      type: dto.type,
      title:
        dto.title ??
        buildSourceTitle({
          source: s.kind,
          label: s.label,
          lastCustomerText: s.lastCustomerText,
        }),
      description: buildSourceDescriptionHtml(descriptionInput(s, dto.note)),
      channel: s.channel,
      contactId: match.value.contact?.id,
      customerId: match.value.customer?.id,
      departmentId: dto.departmentId,
    })
    if (!created.ok) return created
    const ticket = created.value

    const linked = await SdTicketSourceRepository.setLinks(ticket.id, s.links)
    if (!linked.ok) {
      logger.error('servicedesk.ticket_source.link_failed', {
        workspaceId,
        ticketId: ticket.id,
        source: s.kind,
        reason: linked.error.code,
      })
    } else {
      await afterLinked(actorId, workspaceId, ticket, s)
    }

    const ctx = await context(workspaceId)
    const row = await SdTicketSourceRepository.findLinkedTicket(
      workspaceId,
      ticket.id,
    )
    if (!ctx.ok) return ctx
    if (!row.ok) return row
    if (!row.value) return err(sdTicketSourceNotFound())

    return ok({
      ticket: toSdTicketSourceLinkDTO(row.value, ctx.value),
      conversationLinked: linked.ok && Boolean(s.links.whatsappConversationId),
    })
  },
}
