import type {
  DocumentDeliveryChannel,
  DocumentRecipient,
  DocumentRecipientRole,
  DocumentVersion,
  Prisma,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'
import {
  DOCUMENT_VERSION_SUMMARY_SELECT,
  type DocumentVersionSummary,
  documentCreators,
} from './document.repository'

export interface NewDocumentRecipient {
  name: string
  email: string | null
  phone: string | null
  personId: string | null
  role: DocumentRecipientRole
  channel: DocumentDeliveryChannel
  token: string
}

export interface FreezeDocumentInput {
  documentId: string
  workspaceId: string
  actorId: string
  content: Prisma.InputJsonValue
  theme: Prisma.InputJsonValue
  settings: Prisma.InputJsonValue
  sha256: string
  /** Total of the pricing tables (BRL) with the default selection. */
  totalValue: number
  /** `undefined` keeps the stored validity. */
  validUntil?: Date | null
  at: Date
  recipients: NewDocumentRecipient[]
}

export interface FrozenDocument {
  version: DocumentVersion
  recipients: DocumentRecipient[]
}

/** Statuses kept by a new send; anything else goes (back) to SENT. */
const KEPT_ON_SEND = new Set(['VIEWED', 'ACCEPTED'])

export const DocumentVersionRepository = {
  async listByDocument(
    documentId: string,
  ): Promise<Result<DocumentVersionSummary[]>> {
    try {
      const rows = await prisma.documentVersion.findMany({
        where: { documentId },
        select: DOCUMENT_VERSION_SUMMARY_SELECT,
        orderBy: { number: 'desc' },
      })
      const creators = await documentCreators(
        rows.map((row) => row.createdById),
      )
      return ok(
        rows.map((row) => ({
          ...row,
          createdBy: creators.get(row.createdById ?? '') ?? null,
        })),
      )
    } catch (error) {
      return err(dbError('Failed to list document versions', error))
    }
  },

  /**
   * Send: freezes the next version, points the document at it (status,
   * total, validity, first send date) and creates the recipients, all in one
   * transaction. Re-opens an expired or declined document.
   */
  async freeze(input: FreezeDocumentInput): Promise<Result<FrozenDocument>> {
    try {
      const result = await prisma.$transaction(async (tx) => {
        const doc = await tx.document.findUniqueOrThrow({
          where: { id: input.documentId },
          select: { status: true, sentAt: true },
        })
        const last = await tx.documentVersion.aggregate({
          where: { documentId: input.documentId },
          _max: { number: true },
        })
        const version = await tx.documentVersion.create({
          data: {
            documentId: input.documentId,
            workspaceId: input.workspaceId,
            number: (last._max.number ?? 0) + 1,
            content: input.content,
            theme: input.theme,
            settings: input.settings,
            sha256: input.sha256,
            createdById: input.actorId,
          },
        })
        const keep = KEPT_ON_SEND.has(doc.status)
        await tx.document.update({
          where: { id: input.documentId },
          data: {
            currentVersionId: version.id,
            status: keep ? doc.status : 'SENT',
            ...(doc.status === 'ACCEPTED'
              ? {}
              : { totalValue: input.totalValue }),
            sentAt: doc.sentAt ?? input.at,
            ...(input.validUntil !== undefined
              ? { validUntil: input.validUntil }
              : {}),
            ...(doc.status === 'EXPIRED' ? { expiredAt: null } : {}),
            ...(doc.status === 'DECLINED'
              ? { declinedAt: null, declineReason: null }
              : {}),
            updatedById: input.actorId,
          },
        })
        const recipients =
          input.recipients.length > 0
            ? await tx.documentRecipient.createManyAndReturn({
                data: input.recipients.map((recipient) => ({
                  ...recipient,
                  documentId: input.documentId,
                  workspaceId: input.workspaceId,
                })),
              })
            : []
        return { version, recipients }
      })
      return ok(result)
    } catch (error) {
      return err(dbError('Failed to freeze document version', error))
    }
  },
}
