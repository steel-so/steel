import {
  type AppError,
  documentLinkUnavailable,
  documentNotFound,
} from '@/src/errors/app-error'
import type { DocumentVariableValues } from '@/src/lib/canvas-document/context'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from '@/src/repositories/db-error'

/**
 * LOCAL ADAPTER of the docs-backend contract (brief §4), used by the PDF
 * export until that slice is on `main`. Same signatures as
 * `resolveDocumentToken` (`src/services/document-access.ts`) and
 * `DocumentVariablesService.forDocument`
 * (`src/services/document-variables.service.ts`); once they land, this file
 * becomes two re-exports and the callers do not change.
 */

export interface ResolvedDocumentToken {
  documentId: string
  workspaceId: string
  recipientId: string | null
  versionId: string | null
}

/** A recipient token or the document `publicToken` → the sent document. */
export async function resolveDocumentToken(
  token: string,
): Promise<Result<ResolvedDocumentToken, AppError>> {
  try {
    const recipient = await prisma.documentRecipient.findUnique({
      where: { token },
      select: { id: true, documentId: true },
    })
    const document = await prisma.document.findFirst({
      where: recipient ? { id: recipient.documentId } : { publicToken: token },
      select: {
        id: true,
        workspaceId: true,
        currentVersionId: true,
        linkEnabled: true,
        status: true,
        deletedAt: true,
      },
    })
    if (
      !document?.currentVersionId ||
      !document.linkEnabled ||
      document.status === 'ARCHIVED' ||
      document.deletedAt
    ) {
      return err(documentLinkUnavailable())
    }
    return ok({
      documentId: document.id,
      workspaceId: document.workspaceId,
      recipientId: recipient?.id ?? null,
      versionId: document.currentVersionId,
    })
  } catch (error) {
    return err(dbError('Failed to resolve document token', error))
  }
}

const TIMEZONE = 'America/Sao_Paulo'

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date)
}

function formatBrl(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value)
}

export const DocumentVariablesService = {
  /** Merge-tag values of a document for one recipient (or the generic link). */
  async forDocument(
    documentId: string,
    recipientId: string | null,
  ): Promise<Result<DocumentVariableValues, AppError>> {
    try {
      const document = await prisma.document.findUnique({
        where: { id: documentId },
        select: {
          title: true,
          validUntil: true,
          totalValue: true,
          workspace: { select: { name: true } },
          owner: { select: { name: true, email: true } },
        },
      })
      if (!document) return err(documentNotFound())
      const recipient = recipientId
        ? await prisma.documentRecipient.findUnique({
            where: { id: recipientId },
            select: { name: true, email: true },
          })
        : null

      const values: DocumentVariableValues = {
        'documento.titulo': document.title,
        'workspace.nome': document.workspace.name,
        'responsavel.nome': document.owner.name,
        'responsavel.email': document.owner.email,
        'data.hoje': formatDate(new Date()),
      }
      if (document.validUntil) {
        values['documento.validade'] = formatDate(document.validUntil)
      }
      if (document.totalValue !== null) {
        values['documento.total'] = formatBrl(Number(document.totalValue))
      }
      if (recipient) {
        values['destinatario.nome'] = recipient.name
        if (recipient.email) values['destinatario.email'] = recipient.email
      }
      return ok(values)
    } catch (error) {
      return err(dbError('Failed to load document variables', error))
    }
  },
}
