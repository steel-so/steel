import type {
  DocumentResponse,
  DocumentResponseAction,
  Prisma,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'
import { DOCUMENT_OPEN_STATUSES } from './document.repository'

export type DocumentResponseRow = DocumentResponse & {
  version: { number: number }
}

export interface DocumentAnswerInput {
  documentId: string
  workspaceId: string
  versionId: string
  versionSha256: string
  recipientId: string | null
  action: DocumentResponseAction
  name: string | null
  email: string | null
  fields: Prisma.InputJsonValue
  selection: Prisma.InputJsonValue
  totalValue: number | null
  reason: string | null
  ipHash: string
  userAgent: string | null
  at: Date
}

const EVENT_BY_ACTION = {
  ACCEPT: 'ACCEPTED',
  DECLINE: 'DECLINED',
  SUBMIT: 'FIELDS_SUBMITTED',
} as const

/** Document columns written by a final answer (accept or decline). */
function documentAnswerData(
  input: DocumentAnswerInput,
): Prisma.DocumentUpdateManyMutationInput {
  if (input.action === 'ACCEPT') {
    return {
      status: 'ACCEPTED',
      acceptedAt: input.at,
      acceptedByName: input.name,
      acceptedByEmail: input.email,
      ...(input.totalValue !== null ? { totalValue: input.totalValue } : {}),
    }
  }
  return {
    status: 'DECLINED',
    declinedAt: input.at,
    declineReason: input.reason,
  }
}

function recipientAnswerData(
  input: DocumentAnswerInput,
): Prisma.DocumentRecipientUpdateInput {
  if (input.action === 'ACCEPT') {
    return { status: 'ACCEPTED', respondedAt: input.at }
  }
  if (input.action === 'DECLINE') {
    return { status: 'DECLINED', respondedAt: input.at }
  }
  return { respondedAt: input.at }
}

export const DocumentResponseRepository = {
  async listByDocument(
    documentId: string,
  ): Promise<Result<DocumentResponseRow[]>> {
    try {
      const rows = await prisma.documentResponse.findMany({
        where: { documentId },
        include: { version: { select: { number: true } } },
        orderBy: { createdAt: 'desc' },
      })
      return ok(rows)
    } catch (error) {
      return err(dbError('Failed to list document responses', error))
    }
  },

  /** A recipient already sent this kind of answer (submit is once). */
  async hasAnswer(
    documentId: string,
    recipientId: string,
    action: DocumentResponseAction,
  ): Promise<Result<boolean>> {
    try {
      const count = await prisma.documentResponse.count({
        where: { documentId, recipientId, action },
      })
      return ok(count > 0)
    } catch (error) {
      return err(dbError('Failed to check document answers', error))
    }
  },

  /**
   * Records an answer with its evidence, the document/recipient status and
   * the timeline event, in one transaction. Accept and decline only land
   * while the document is still open on that version: `null` = someone
   * answered (or the owner re-sent) in between.
   */
  async answer(
    input: DocumentAnswerInput,
  ): Promise<Result<DocumentResponse | null>> {
    try {
      const response = await prisma.$transaction(async (tx) => {
        if (input.action !== 'SUBMIT') {
          const { count } = await tx.document.updateMany({
            where: {
              id: input.documentId,
              status: { in: [...DOCUMENT_OPEN_STATUSES] },
              currentVersionId: input.versionId,
              deletedAt: null,
            },
            data: documentAnswerData(input),
          })
          if (count === 0) return null
        }
        const created = await tx.documentResponse.create({
          data: {
            documentId: input.documentId,
            workspaceId: input.workspaceId,
            versionId: input.versionId,
            recipientId: input.recipientId,
            action: input.action,
            name: input.name,
            email: input.email,
            fields: input.fields,
            selection: input.selection,
            totalValue: input.totalValue,
            reason: input.reason,
            versionSha256: input.versionSha256,
            ipHash: input.ipHash,
            userAgent: input.userAgent,
            createdAt: input.at,
          },
        })
        if (input.recipientId) {
          await tx.documentRecipient.update({
            where: { id: input.recipientId },
            data: recipientAnswerData(input),
          })
        }
        await tx.documentEvent.create({
          data: {
            documentId: input.documentId,
            workspaceId: input.workspaceId,
            type: EVENT_BY_ACTION[input.action],
            recipientId: input.recipientId,
            data: {
              responseId: created.id,
              name: input.name,
              totalValue: input.totalValue,
            },
          },
        })
        return created
      })
      return ok(response)
    } catch (error) {
      return err(dbError('Failed to record document answer', error))
    }
  },
}
