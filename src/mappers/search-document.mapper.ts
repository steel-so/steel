import {
  clampBody,
  joinParts,
  type SearchDocumentHit,
  type SearchDocumentInput,
  snippetOf,
  stripHtml,
  userIdsOf,
} from '@/src/lib/search/search-document'
import { SEARCH_ENTITIES } from '@/src/lib/search/search-entities'
import { codesFor } from '@/src/lib/search/search-query'
import {
  formatSdTicketCode,
  resolveSdTicketPrefixes,
} from '@/src/lib/servicedesk/ticket-code'
import type {
  CrmCompanySearchRow,
  CrmDocumentSearchRow,
  CrmLeadSearchRow,
  CrmOpportunitySearchRow,
  CrmPersonSearchRow,
  CrmProposalSearchRow,
  CrmTaskSearchRow,
  MemberSearchRow,
  SdConfigItemSearchRow,
  SdContactSearchRow,
  SdCustomerSearchRow,
  SdKbArticleSearchRow,
  SdTicketSearchRow,
  WhiteboardSearchRow,
  ZapContactSearchRow,
  ZapConversationSearchRow,
} from '@/src/repositories/search-source.repository'
import {
  DOCUMENT_KIND_LABELS,
  DOCUMENT_STATUS_LABELS,
} from '@/src/schemas/document.schema'
import type { SearchResultDTO } from '@/types/search'
import { toWhiteboardScene, whiteboardSceneText } from './whiteboard.mapper'

/**
 * Builds the `search_documents` row of each indexed entity and maps a
 * ranked hit back to the API DTO. Labels are pt-BR (the palette shows
 * them); paths are relative to the workspace (`/${slug}` is prefixed when
 * the DTO is built, so renaming a workspace never stales the index).
 */

const SD_TICKET_TYPE_LABEL: Record<string, string> = {
  INCIDENT: 'Incidente',
  SERVICE_REQUEST: 'Requisição',
  CHANGE: 'Mudança',
  PROBLEM: 'Problema',
}

const KB_STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Rascunho',
  IN_REVIEW: 'Em revisão',
  PUBLISHED: 'Publicado',
}

const LEAD_STAGE_LABEL: Record<string, string> = {
  RECEIVED: 'Recebido',
  IN_CONTACT: 'Em contato',
  QUALIFIED: 'Qualificado',
  OPPORTUNITY: 'Oportunidade',
  PROPOSAL: 'Proposta',
  CLOSED: 'Fechado',
}

const TASK_STATUS_LABEL: Record<string, string> = {
  TODO: 'A fazer',
  IN_PROGRESS: 'Em andamento',
  DONE: 'Concluída',
}

const PROPOSAL_STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Rascunho',
  SENT: 'Enviada',
  VIEWED: 'Visualizada',
  ACCEPTED: 'Aceita',
  REJECTED: 'Recusada',
  EXPIRED: 'Expirada',
}

const CONVERSATION_STATUS_LABEL: Record<string, string> = {
  NEW: 'Nova',
  IN_PROGRESS: 'Em atendimento',
  CLOSED: 'Encerrada',
}

const ROLE_LABEL: Record<string, string> = {
  OWNER: 'Proprietário',
  ADMIN: 'Administrador',
  MEMBER: 'Membro',
  VIEWER: 'Visualizador',
}

function recordPath(base: string, id: string): string {
  return `${base}?record=${encodeURIComponent(id)}`
}

/** Text form of the exact-match keys plus the words around them. */
function keywordsOf(values: ReadonlyArray<string | null | undefined>): string {
  const words = new Set<string>()
  for (const raw of values) {
    if (!raw) continue
    const value = raw.trim()
    if (!value) continue
    words.add(value)
    // `joao.silva@acme.com` → also `joao silva acme com` (partial e-mail).
    if (/[@._-]/.test(value)) words.add(value.replace(/[@._-]+/g, ' '))
  }
  return [...words].join(' ')
}

function formatPhone(waId: string): string {
  const d = waId.replace(/\D/g, '')
  const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(d)
  return m ? `+55 (${m[1]}) ${m[2]}-${m[3]}` : waId
}

export function toSdTicketSearchDocument(
  workspaceId: string,
  row: SdTicketSearchRow,
  rawPrefixes: unknown,
): SearchDocumentInput {
  const code = formatSdTicketCode(
    row.type,
    row.number,
    resolveSdTicketPrefixes(rawPrefixes),
  )
  const requester = row.requester?.name ?? row.contact?.name ?? null
  return {
    workspaceId,
    entityType: 'sd-ticket',
    entityId: row.id,
    module: 'SERVICE_DESK',
    audience: 'PARTIES',
    title: row.title,
    subtitle: joinParts([
      code,
      SD_TICKET_TYPE_LABEL[row.type],
      row.phase.name,
      requester ? `Solicitante: ${requester}` : null,
    ]),
    body: clampBody(
      joinParts(
        [
          stripHtml(row.description),
          row.customer?.name,
          row.company?.name,
          row.contact?.name,
        ],
        ' ',
      ),
    ),
    keywords: keywordsOf([code, String(row.number)]),
    codes: codesFor([code, String(row.number)]),
    userIds: userIdsOf([
      row.requesterId,
      row.assigneeId,
      row.contact?.userId,
      ...row.participants.map((p) => p.userId),
    ]),
    path: `/servicedesk/tickets/${row.number}`,
    updatedAt: row.updatedAt,
  }
}

export function toSdKbArticleSearchDocument(
  workspaceId: string,
  row: SdKbArticleSearchRow,
): SearchDocumentInput {
  const portal =
    row.status === 'PUBLISHED' &&
    row.visibility === 'PORTAL' &&
    row.archivedAt === null
  return {
    workspaceId,
    entityType: 'sd-kb-article',
    entityId: row.id,
    module: 'SERVICE_DESK',
    audience: portal ? 'PUBLIC' : 'AGENTS',
    title: row.title,
    subtitle: joinParts([
      row.category?.name,
      KB_STATUS_LABEL[row.status],
      row.visibility === 'PORTAL' ? 'Portal' : 'Interno',
    ]),
    body: clampBody(row.plainText),
    keywords: keywordsOf(row.tags),
    codes: [],
    userIds: userIdsOf([row.createdById]),
    path: `/servicedesk/knowledge/${row.id}`,
    updatedAt: row.updatedAt,
  }
}

export function toSdCustomerSearchDocument(
  workspaceId: string,
  row: SdCustomerSearchRow,
): SearchDocumentInput {
  const base =
    row.kind === 'COMPANY' ? '/servicedesk/companies' : '/servicedesk/customers'
  return {
    workspaceId,
    entityType: 'sd-customer',
    entityId: row.id,
    module: 'SERVICE_DESK',
    audience: 'AGENTS',
    title: row.name,
    subtitle: joinParts([
      row.kind === 'COMPANY' ? 'Empresa' : 'Cliente',
      row.tradeName,
      row.document,
      joinParts([row.city, row.state], '/'),
    ]),
    body: clampBody(row.notes),
    keywords: keywordsOf([
      row.tradeName,
      row.document,
      row.email,
      row.phone,
      row.whatsapp,
    ]),
    codes: codesFor([row.document, row.email, row.phone, row.whatsapp]),
    userIds: userIdsOf([row.createdById]),
    path: recordPath(base, row.id),
    updatedAt: row.updatedAt,
  }
}

export function toSdContactSearchDocument(
  workspaceId: string,
  row: SdContactSearchRow,
): SearchDocumentInput {
  return {
    workspaceId,
    entityType: 'sd-contact',
    entityId: row.id,
    module: 'SERVICE_DESK',
    audience: 'AGENTS',
    title: row.name,
    subtitle: joinParts([
      row.jobTitle,
      row.customers.map((c) => c.customer.name).join(', ') || null,
      row.email,
    ]),
    body: clampBody(row.notes),
    keywords: keywordsOf([row.email, row.phone, row.whatsapp]),
    codes: codesFor([row.email, row.phone, row.whatsapp]),
    userIds: userIdsOf([row.userId]),
    path: recordPath('/servicedesk/contacts', row.id),
    updatedAt: row.updatedAt,
  }
}

export function toSdConfigItemSearchDocument(
  workspaceId: string,
  row: SdConfigItemSearchRow,
): SearchDocumentInput {
  return {
    workspaceId,
    entityType: 'sd-config-item',
    entityId: row.id,
    module: 'SERVICE_DESK',
    audience: 'AGENTS',
    title: row.name,
    subtitle: joinParts([row.type?.name, row.code, row.customer?.name]),
    body: clampBody(
      joinParts([row.manufacturer, row.model, row.location, row.notes], ' '),
    ),
    keywords: keywordsOf([row.code, row.serialNumber, row.ipAddress]),
    codes: codesFor([row.code, row.serialNumber, row.ipAddress]),
    userIds: userIdsOf([row.ownerId]),
    path: recordPath('/servicedesk/config-items', row.id),
    updatedAt: row.updatedAt,
  }
}

export function toCrmLeadSearchDocument(
  workspaceId: string,
  row: CrmLeadSearchRow,
): SearchDocumentInput {
  return {
    workspaceId,
    entityType: 'crm-lead',
    entityId: row.id,
    module: 'CRM',
    audience: 'PUBLIC',
    title: row.name,
    subtitle: joinParts([
      row.company,
      row.jobTitle,
      LEAD_STAGE_LABEL[row.stage],
    ]),
    body: clampBody(joinParts([row.city, row.source, row.channel], ' ')),
    keywords: keywordsOf([...row.emails, ...row.phones]),
    codes: codesFor([...row.emails, ...row.phones]),
    userIds: userIdsOf([row.ownerId]),
    path: recordPath('/crm/leads', row.id),
    updatedAt: row.updatedAt,
  }
}

export function toCrmOpportunitySearchDocument(
  workspaceId: string,
  row: CrmOpportunitySearchRow,
): SearchDocumentInput {
  return {
    workspaceId,
    entityType: 'crm-opportunity',
    entityId: row.id,
    module: 'CRM',
    audience: 'PUBLIC',
    title: row.name,
    subtitle: joinParts([row.company?.name, row.stage.name]),
    body: clampBody(joinParts([row.pointOfContact?.name, row.source], ' ')),
    keywords: '',
    codes: [],
    userIds: userIdsOf([row.ownerId, row.createdById]),
    path: recordPath('/crm/opportunities', row.id),
    updatedAt: row.updatedAt,
  }
}

export function toCrmPersonSearchDocument(
  workspaceId: string,
  row: CrmPersonSearchRow,
): SearchDocumentInput {
  return {
    workspaceId,
    entityType: 'crm-person',
    entityId: row.id,
    module: 'CRM',
    audience: 'PUBLIC',
    title: row.name,
    subtitle: joinParts([row.jobTitle, row.company?.name, row.emails[0]]),
    body: clampBody(row.city),
    keywords: keywordsOf([...row.emails, ...row.phones]),
    codes: codesFor([...row.emails, ...row.phones]),
    userIds: userIdsOf([row.createdById]),
    path: recordPath('/crm/people', row.id),
    updatedAt: row.updatedAt,
  }
}

export function toCrmCompanySearchDocument(
  workspaceId: string,
  row: CrmCompanySearchRow,
): SearchDocumentInput {
  return {
    workspaceId,
    entityType: 'crm-company',
    entityId: row.id,
    module: 'CRM',
    audience: 'PUBLIC',
    title: row.name || 'Empresa sem nome',
    subtitle: joinParts([row.domain, row.cnpj]),
    body: null,
    keywords: keywordsOf([row.domain, row.cnpj]),
    codes: codesFor([row.domain, row.cnpj]),
    userIds: userIdsOf([row.accountOwnerId, row.createdById]),
    path: recordPath('/crm/companies', row.id),
    updatedAt: row.updatedAt,
  }
}

export function toCrmTaskSearchDocument(
  workspaceId: string,
  row: CrmTaskSearchRow,
): SearchDocumentInput {
  return {
    workspaceId,
    entityType: 'crm-task',
    entityId: row.id,
    module: 'CRM',
    audience: 'PUBLIC',
    title: row.title,
    subtitle: joinParts([
      TASK_STATUS_LABEL[row.status],
      row.opportunity?.name ?? row.company?.name ?? row.person?.name,
    ]),
    body: clampBody(row.body),
    keywords: '',
    codes: [],
    userIds: userIdsOf([row.assigneeId, row.createdById]),
    path: recordPath('/crm/tasks', row.id),
    updatedAt: row.updatedAt,
  }
}

export function toCrmProposalSearchDocument(
  workspaceId: string,
  row: CrmProposalSearchRow,
): SearchDocumentInput {
  return {
    workspaceId,
    entityType: 'crm-proposal',
    entityId: row.id,
    module: 'CRM',
    audience: 'PUBLIC',
    title: row.name,
    subtitle: joinParts([
      PROPOSAL_STATUS_LABEL[row.status],
      row.company?.name ?? row.lead?.name,
      row.contact?.name,
    ]),
    body: null,
    keywords: '',
    codes: [],
    userIds: userIdsOf([row.responsibleId]),
    path: `/crm/proposals/${row.id}`,
    updatedAt: row.updatedAt,
  }
}

/** CRM > Documentos (ADR 0063): documents and templates of any kind. */
export function toCrmDocumentSearchDocument(
  workspaceId: string,
  row: CrmDocumentSearchRow,
): SearchDocumentInput {
  return {
    workspaceId,
    entityType: 'crm-document',
    entityId: row.id,
    module: 'CRM',
    audience: 'PUBLIC',
    title: row.title,
    subtitle: joinParts([
      DOCUMENT_KIND_LABELS[row.kind],
      row.isTemplate ? 'Modelo' : DOCUMENT_STATUS_LABELS[row.status],
      row.company?.name ?? row.lead?.name,
      row.person?.name,
      row.opportunity?.name,
    ]),
    body: null,
    keywords: '',
    codes: [],
    userIds: userIdsOf([row.ownerId]),
    path: `/crm/documents/${row.id}`,
    updatedAt: row.updatedAt,
  }
}

export function toZapContactSearchDocument(
  workspaceId: string,
  row: ZapContactSearchRow,
): SearchDocumentInput {
  const phone = formatPhone(row.waId)
  return {
    workspaceId,
    entityType: 'zap-contact',
    entityId: row.id,
    module: 'COMMUNICATION',
    audience: 'PUBLIC',
    title: row.name?.trim() || phone,
    subtitle: phone,
    body: clampBody(row.description),
    keywords: keywordsOf([row.waId]),
    codes: codesFor([row.waId]),
    userIds: [],
    path: `/zap/contatos?q=${encodeURIComponent(row.waId)}`,
    updatedAt: row.updatedAt,
  }
}

export function toZapConversationSearchDocument(
  workspaceId: string,
  row: ZapConversationSearchRow,
): SearchDocumentInput {
  const phone = formatPhone(row.contact.waId)
  const last = row.messages[0]
  // "Limpar conversa" hides what came before `clearedAt` — so does search.
  const visible =
    last && (!row.clearedAt || last.createdAt > row.clearedAt) ? last : null
  return {
    workspaceId,
    entityType: 'zap-conversation',
    entityId: row.id,
    module: 'COMMUNICATION',
    audience: 'PUBLIC',
    title: row.contact.name?.trim() || phone,
    subtitle: joinParts([
      phone,
      CONVERSATION_STATUS_LABEL[row.status],
      row.archivedAt ? 'Arquivada' : null,
    ]),
    body: clampBody(visible?.text),
    keywords: keywordsOf([row.contact.waId]),
    codes: codesFor([row.contact.waId]),
    userIds: userIdsOf([row.assignedUserId]),
    path: `/zap?conversa=${encodeURIComponent(row.id)}`,
    updatedAt: row.lastMessageAt ?? row.updatedAt,
  }
}

export function toMemberSearchDocument(
  workspaceId: string,
  row: MemberSearchRow,
): SearchDocumentInput {
  const updatedAt =
    row.user.updatedAt > row.updatedAt ? row.user.updatedAt : row.updatedAt
  return {
    workspaceId,
    entityType: 'member',
    entityId: row.userId,
    module: null,
    audience: 'PUBLIC',
    title: row.user.name,
    subtitle: joinParts([row.user.email, ROLE_LABEL[row.role]]),
    body: null,
    keywords: keywordsOf([row.user.email, row.user.username]),
    codes: codesFor([row.user.email, row.user.username]),
    userIds: [row.userId],
    path: '/settings/members',
    updatedAt,
  }
}

export function toWhiteboardSearchDocument(
  workspaceId: string,
  row: WhiteboardSearchRow,
): SearchDocumentInput {
  return {
    workspaceId,
    entityType: 'whiteboard',
    entityId: row.id,
    module: null,
    audience: 'PUBLIC',
    title: row.title || 'Quadro sem título',
    subtitle: joinParts(['Quadro-branco', row.createdBy?.name]),
    body: clampBody(whiteboardSceneText(toWhiteboardScene(row.scene))),
    keywords: '',
    codes: [],
    userIds: userIdsOf([row.createdById, row.updatedById]),
    path: `/whiteboard/${row.id}`,
    updatedAt: row.editedAt,
  }
}

export function toSearchResultDTO(
  hit: SearchDocumentHit & { score: number },
  slug: string,
): SearchResultDTO {
  return {
    type: hit.entityType,
    id: hit.entityId,
    title: hit.title,
    subtitle: hit.subtitle,
    snippet: snippetOf(hit.body),
    href: `/${slug}${hit.path}`,
    module: hit.module,
    group: SEARCH_ENTITIES[hit.entityType].group,
    score: hit.score,
    isMine: hit.isMine,
    updatedAt: hit.updatedAt.toISOString(),
  }
}
