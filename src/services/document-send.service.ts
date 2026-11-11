import type { Prisma } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { validationError } from '@/src/errors'
import { documentContentInvalid, documentEmpty } from '@/src/errors/app-error'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import { validateDocumentContent } from '@/src/lib/canvas-document/catalog'
import { documentPricingTotals } from '@/src/lib/canvas-document/pricing'
import { documentSections } from '@/src/lib/canvas-document/sections'
import { isProposalValidityPast } from '@/src/lib/crm-proposal-validity'
import { documentVersionHash, newDocumentToken } from '@/src/lib/documents/hash'
import { parseDocumentSettings } from '@/src/lib/documents/settings'
import { err, ok, type Result } from '@/src/lib/result'
import {
  toDocumentDTO,
  toDocumentRecipientDTO,
} from '@/src/mappers/document.mapper'
import {
  type DocumentFull,
  DocumentRepository,
} from '@/src/repositories/document.repository'
import {
  DocumentEventRepository,
  type NewDocumentEvent,
} from '@/src/repositories/document-event.repository'
import { DocumentRecipientRepository } from '@/src/repositories/document-recipient.repository'
import {
  DocumentVersionRepository,
  type NewDocumentRecipient,
} from '@/src/repositories/document-version.repository'
import type {
  AddDocumentRecipientsInput,
  DocumentRecipientInput,
  SendDocumentInput,
} from '@/src/schemas/document.schema'
import type {
  DocumentRecipientDeliveryDTO,
  DocumentRecipientDTO,
  DocumentSendResultDTO,
} from '@/types/document'
import { assertModuleMember } from './authz'
import {
  type DocumentDeliveryOutcome,
  deliverDocument,
} from './document-delivery'

/**
 * Sending of CRM > Documentos (ADR 0063): freezes an immutable version,
 * creates the recipients with their own tokens and delivers the links by
 * e-mail, WhatsApp or as a link to copy. Same `documents` × `EDIT`
 * permission the legacy proposal send used.
 */

function access(
  actorId: string,
  workspaceId: string,
  action: 'VIEW' | 'EDIT',
) {
  return assertModuleMember(actorId, workspaceId, 'CRM', {
    resource: 'documents',
    action,
  })
}

/** A document with no section, or only empty sections, cannot be sent. */
function isEmptyDocument(doc: CanvasDocument): boolean {
  const sections = documentSections(doc)
  if (sections.length === 0) return true
  return sections.every(
    (section) => (doc.nodes[section.id]?.children ?? []).length === 0,
  )
}

function newRecipients(
  inputs: DocumentRecipientInput[],
): NewDocumentRecipient[] {
  return inputs.map((input) => ({
    name: input.name,
    email: input.email?.toLowerCase() ?? null,
    phone: input.phone ?? null,
    personId: input.personId ?? null,
    role: input.role,
    channel: input.channel,
    token: newDocumentToken(),
  }))
}

function deliveryContext(doc: DocumentFull, message?: string | null) {
  return {
    workspaceId: doc.workspaceId,
    documentId: doc.id,
    documentTitle: doc.title,
    workspaceName: doc.workspace.name,
    senderName: doc.owner.name,
    senderEmail: doc.owner.email,
    validUntil: doc.validUntil,
    message: message ?? null,
  }
}

function sentEvents(
  doc: DocumentFull,
  actorId: string,
  outcomes: DocumentDeliveryOutcome[],
  extra: Record<string, Prisma.InputJsonValue>,
): NewDocumentEvent[] {
  return outcomes.map((outcome) => ({
    documentId: doc.id,
    workspaceId: doc.workspaceId,
    type: 'SENT' as const,
    recipientId: outcome.recipient.id,
    actorId,
    data: {
      ...extra,
      requested: outcome.delivery.requested,
      channel: outcome.delivery.channel,
      delivered: outcome.delivery.delivered,
    },
  }))
}

export const DocumentSendService = {
  /**
   * Freezes the next version (SHA-256 of content + theme + settings), sets
   * it as current with the pricing total, moves the status to SENT (VIEWED
   * and ACCEPTED are kept) and delivers to the new recipients.
   */
  async send(
    actorId: string,
    workspaceId: string,
    documentId: string,
    dto: SendDocumentInput,
  ): Promise<Result<DocumentSendResultDTO>> {
    const membership = await access(actorId, workspaceId, 'EDIT')
    if (!membership.ok) return membership

    const existing = await DocumentRepository.findById(documentId, workspaceId)
    if (!existing.ok) return existing
    const doc = existing.value

    if (doc.isTemplate) {
      return err(
        validationError(
          'Um modelo não é enviado: crie um documento a partir dele.',
        ),
      )
    }
    if (doc.status === 'ARCHIVED') {
      return err(validationError('Desarquive o documento antes de enviar.'))
    }

    const valid = validateDocumentContent(doc.content)
    if (!valid.ok) return err(documentContentInvalid(valid.error))
    if (isEmptyDocument(valid.value)) return err(documentEmpty())

    const validUntil =
      dto.validUntil !== undefined ? dto.validUntil : doc.validUntil
    if (validUntil && isProposalValidityPast(validUntil)) {
      return err(
        validationError(
          'A validade já passou: escolha hoje ou uma data futura antes de enviar.',
        ),
      )
    }

    const settings = parseDocumentSettings(doc.settings)
    const now = new Date()
    const frozen = await DocumentVersionRepository.freeze({
      documentId,
      workspaceId,
      actorId,
      content: doc.content as Prisma.InputJsonValue,
      theme: doc.theme as Prisma.InputJsonValue,
      settings,
      sha256: documentVersionHash({
        content: doc.content,
        theme: doc.theme,
        settings,
      }),
      totalValue: documentPricingTotals(valid.value).total,
      validUntil: dto.validUntil,
      at: now,
      recipients: newRecipients(dto.recipients),
    })
    if (!frozen.ok) {
      auditMutation({
        entity: 'document',
        action: 'send',
        actorId,
        targetId: documentId,
        outcome: 'failure',
        reason: frozen.error.code,
      })
      return frozen
    }

    const outcomes = await deliverDocument(
      { ...deliveryContext(doc, dto.message), validUntil },
      frozen.value.recipients,
      now,
    )
    const versionNumber = frozen.value.version.number
    await DocumentEventRepository.createMany(
      outcomes.length > 0
        ? sentEvents(doc, actorId, outcomes, { versionNumber })
        : [
            {
              documentId,
              workspaceId,
              type: 'SENT',
              actorId,
              data: { versionNumber },
            },
          ],
    )
    auditMutation({
      entity: 'document',
      action: 'send',
      actorId,
      targetId: documentId,
      meta: {
        workspaceId,
        versionNumber,
        recipients: outcomes.length,
        channels: outcomes.map((outcome) => outcome.delivery.channel),
      },
    })

    const reloaded = await DocumentRepository.findById(documentId, workspaceId)
    if (!reloaded.ok) return reloaded
    return ok({
      ...toDocumentDTO(reloaded.value),
      deliveries: outcomes.map((outcome) => outcome.delivery),
    })
  },

  async listRecipients(
    actorId: string,
    workspaceId: string,
    documentId: string,
  ): Promise<Result<DocumentRecipientDTO[]>> {
    const membership = await access(actorId, workspaceId, 'VIEW')
    if (!membership.ok) return membership
    const existing = await DocumentRepository.findMeta(documentId, workspaceId)
    if (!existing.ok) return existing

    const result = await DocumentRecipientRepository.listByDocument(documentId)
    if (!result.ok) return result
    return ok(result.value.map(toDocumentRecipientDTO))
  },

  /** More readers of the current version (the document must be sent). */
  async addRecipients(
    actorId: string,
    workspaceId: string,
    documentId: string,
    dto: AddDocumentRecipientsInput,
  ): Promise<Result<DocumentRecipientDeliveryDTO[]>> {
    const membership = await access(actorId, workspaceId, 'EDIT')
    if (!membership.ok) return membership

    const existing = await DocumentRepository.findById(documentId, workspaceId)
    if (!existing.ok) return existing
    const doc = existing.value
    if (!doc.currentVersion || doc.status === 'ARCHIVED') {
      return err(
        validationError('Envie o documento antes de adicionar destinatários.'),
      )
    }

    const created = await DocumentRecipientRepository.createMany(
      documentId,
      workspaceId,
      newRecipients(dto.recipients),
    )
    if (!created.ok) return created

    const outcomes = await deliverDocument(
      deliveryContext(doc, dto.message),
      created.value,
      new Date(),
    )
    await DocumentEventRepository.createMany(
      sentEvents(doc, actorId, outcomes, {
        versionNumber: doc.currentVersion.number,
      }),
    )
    auditMutation({
      entity: 'document_recipient',
      action: 'create',
      actorId,
      targetId: documentId,
      meta: { workspaceId, recipients: outcomes.length },
    })
    return ok(
      outcomes.map((outcome) => ({
        ...toDocumentRecipientDTO(outcome.recipient),
        delivery: outcome.delivery,
      })),
    )
  },

  async removeRecipient(
    actorId: string,
    workspaceId: string,
    documentId: string,
    recipientId: string,
  ): Promise<Result<void>> {
    const membership = await access(actorId, workspaceId, 'EDIT')
    if (!membership.ok) return membership
    const existing = await DocumentRepository.findMeta(documentId, workspaceId)
    if (!existing.ok) return existing
    const recipient = await DocumentRecipientRepository.findById(
      recipientId,
      documentId,
    )
    if (!recipient.ok) return recipient

    const removed = await DocumentRecipientRepository.delete(recipientId)
    if (!removed.ok) return removed

    auditMutation({
      entity: 'document_recipient',
      action: 'delete',
      actorId,
      targetId: recipientId,
      meta: { workspaceId, documentId },
    })
    return ok(undefined)
  },

  /** Delivers the current version again to one recipient. */
  async resendRecipient(
    actorId: string,
    workspaceId: string,
    documentId: string,
    recipientId: string,
  ): Promise<Result<DocumentRecipientDeliveryDTO>> {
    const membership = await access(actorId, workspaceId, 'EDIT')
    if (!membership.ok) return membership

    const existing = await DocumentRepository.findById(documentId, workspaceId)
    if (!existing.ok) return existing
    const doc = existing.value
    if (!doc.currentVersion || doc.status === 'ARCHIVED') {
      return err(
        validationError('Envie o documento antes de reenviar o link.'),
      )
    }
    const recipient = await DocumentRecipientRepository.findById(
      recipientId,
      documentId,
    )
    if (!recipient.ok) return recipient

    const [outcome] = await deliverDocument(
      deliveryContext(doc),
      [recipient.value],
      new Date(),
    )
    await DocumentEventRepository.createMany(
      sentEvents(doc, actorId, [outcome], {
        versionNumber: doc.currentVersion.number,
        resend: true,
      }),
    )
    auditMutation({
      entity: 'document_recipient',
      action: 'send',
      actorId,
      targetId: recipientId,
      meta: { workspaceId, documentId, channel: outcome.delivery.channel },
    })
    return ok({
      ...toDocumentRecipientDTO(outcome.recipient),
      delivery: outcome.delivery,
    })
  },
}
