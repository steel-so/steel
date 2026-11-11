import type { DocumentRecipient, Prisma } from '@prisma/client'
import { baseEmailUrl } from '@/lib/base-email-url'
import { isProposalValidityPast } from '@/src/lib/crm-proposal-validity'
import { documentVersionHash } from '@/src/lib/documents/hash'
import { parseDocumentSettings } from '@/src/lib/documents/settings'
import type {
  DocumentFull,
  DocumentListRow,
  DocumentPublicContext,
  DocumentVersionSummary,
} from '@/src/repositories/document.repository'
import type { DocumentEventRow } from '@/src/repositories/document-event.repository'
import type { DocumentResponseRow } from '@/src/repositories/document-response.repository'
import type {
  DocumentDTO,
  DocumentEventDTO,
  DocumentListItemDTO,
  DocumentPublicDTO,
  DocumentRecipientDTO,
  DocumentResponseDTO,
  DocumentVersionDTO,
} from '@/types/document'

/** Absolute public link `/d/<token>` (generic or personal). */
export function documentLinkUrl(token: string): string {
  return `${baseEmailUrl}/d/${token}`
}

/** A JSON column as a plain object (anything else → `{}`). */
export function jsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {}
  }
  return value as Record<string, unknown>
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null
}

function money(value: Prisma.Decimal | null): number | null {
  return value === null ? null : Number(value)
}

export function toDocumentRecipientDTO(
  recipient: DocumentRecipient,
): DocumentRecipientDTO {
  return {
    id: recipient.id,
    name: recipient.name,
    email: recipient.email,
    phone: recipient.phone,
    role: recipient.role,
    status: recipient.status,
    channel: recipient.channel,
    url: documentLinkUrl(recipient.token),
    sentAt: iso(recipient.sentAt),
    firstViewedAt: iso(recipient.firstViewedAt),
    lastViewedAt: iso(recipient.lastViewedAt),
    respondedAt: iso(recipient.respondedAt),
  }
}

export function toDocumentVersionDTO(
  version: DocumentVersionSummary,
): DocumentVersionDTO {
  return {
    id: version.id,
    number: version.number,
    sha256: version.sha256,
    createdAt: version.createdAt.toISOString(),
    createdBy: version.createdBy,
  }
}

export function toDocumentListItemDTO(
  row: DocumentListRow,
): DocumentListItemDTO {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    title: row.title,
    kind: row.kind,
    status: row.status,
    isTemplate: row.isTemplate,
    source: row.source,
    owner: { id: row.owner.id, name: row.owner.name, image: row.owner.image },
    company: row.company,
    person: row.person,
    opportunity: row.opportunity,
    lead: row.lead,
    totalValue: money(row.totalValue),
    validUntil: iso(row.validUntil),
    sentAt: iso(row.sentAt),
    firstViewedAt: iso(row.firstViewedAt),
    lastViewedAt: iso(row.lastViewedAt),
    acceptedAt: iso(row.acceptedAt),
    viewCount: row._count.sessions,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** The draft (content + theme + settings) differs from the sent version. */
function hasUnsentChanges(row: DocumentFull): boolean {
  if (!row.currentVersion) return false
  const draft = documentVersionHash({
    content: row.content,
    theme: row.theme,
    settings: parseDocumentSettings(row.settings),
  })
  return draft !== row.currentVersion.sha256
}

export function toDocumentDTO(row: DocumentFull): DocumentDTO {
  return {
    ...toDocumentListItemDTO(row),
    description: row.description,
    content: jsonRecord(row.content),
    theme: jsonRecord(row.theme),
    settings: parseDocumentSettings(row.settings),
    templateId: row.templateId,
    currentVersion: row.currentVersion
      ? toDocumentVersionDTO(row.currentVersion)
      : null,
    hasUnsentChanges: hasUnsentChanges(row),
    publicToken: row.publicToken,
    publicUrl: documentLinkUrl(row.publicToken),
    linkEnabled: row.linkEnabled,
    acceptedByName: row.acceptedByName,
    acceptedByEmail: row.acceptedByEmail,
    declinedAt: iso(row.declinedAt),
    declineReason: row.declineReason,
    expiredAt: iso(row.expiredAt),
    paidAt: iso(row.paidAt),
    recipients: row.recipients.map(toDocumentRecipientDTO),
  }
}

export function toDocumentEventDTO(row: DocumentEventRow): DocumentEventDTO {
  return {
    id: row.id,
    type: row.type,
    recipient: row.recipient,
    actor: row.actor,
    data: jsonRecord(row.data),
    createdAt: row.createdAt.toISOString(),
  }
}

export function toDocumentResponseDTO(
  row: DocumentResponseRow,
): DocumentResponseDTO {
  return {
    id: row.id,
    action: row.action,
    name: row.name,
    email: row.email,
    recipientId: row.recipientId,
    versionNumber: row.version.number,
    fields: jsonRecord(row.fields),
    selection: jsonRecord(row.selection) as DocumentResponseDTO['selection'],
    totalValue: money(row.totalValue),
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
  }
}

/**
 * Public status of a document: SENT/VIEWED past the validity read as
 * EXPIRED even before the daily job runs.
 */
export function publicDocumentStatus(
  doc: Pick<DocumentPublicContext, 'status' | 'validUntil'>,
  now: Date = new Date(),
): DocumentPublicDTO['document']['status'] {
  const open = doc.status === 'SENT' || doc.status === 'VIEWED'
  if (open && isProposalValidityPast(doc.validUntil, now)) return 'EXPIRED'
  return doc.status
}

/** What `/d/<token>` renders: the frozen version, never the draft. */
export function toDocumentPublicDTO(input: {
  token: string
  context: DocumentPublicContext & {
    currentVersion: NonNullable<DocumentPublicContext['currentVersion']>
  }
  recipient: DocumentRecipient | null
  variables: Record<string, string>
}): DocumentPublicDTO {
  const { context: doc, recipient } = input
  const version = doc.currentVersion
  const settings = parseDocumentSettings(version.settings)
  return {
    token: input.token,
    document: {
      id: doc.id,
      title: doc.title,
      kind: doc.kind,
      status: publicDocumentStatus(doc),
      validUntil: iso(doc.validUntil),
      acceptedAt: iso(doc.acceptedAt),
      acceptedByName: doc.acceptedByName,
      declinedAt: iso(doc.declinedAt),
      settings,
      theme: jsonRecord(version.theme),
    },
    version: {
      id: version.id,
      number: version.number,
      content: jsonRecord(version.content),
    },
    recipient: recipient
      ? {
          id: recipient.id,
          name: recipient.name,
          role: recipient.role,
          status: recipient.status,
        }
      : null,
    variables: input.variables,
    // The generic link may accept; a personal link only as APPROVER.
    canAccept: recipient ? recipient.role === 'APPROVER' : true,
    canDownload: settings.allowDownload,
    // Pix/boleto stay off in this wave (PSP still mocked).
    paymentEnabled: false,
    brand: { name: doc.workspace.name, logoUrl: doc.workspace.logoUrl },
  }
}
