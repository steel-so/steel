import type { AppError } from '@/src/errors/app-error'
import {
  documentLinkUnavailable,
  documentNotFound,
} from '@/src/errors/app-error'
import { err, ok, type Result } from '@/src/lib/result'
import { DocumentTrackRepository } from '@/src/repositories/document-track.repository'

/**
 * Local adapter of the public-link contract `resolveDocumentToken`
 * (`src/services/document-access.ts`, owned by the documents backend
 * slice), with the same signature and rules. The tracking service switches
 * to the backend export once both are on main; until then this keeps the
 * beacon route working on its own.
 */
export interface ResolvedDocumentToken {
  documentId: string
  workspaceId: string
  recipientId: string | null
  versionId: string | null
}

export async function resolveDocumentToken(
  token: string,
): Promise<Result<ResolvedDocumentToken, AppError>> {
  const link = await DocumentTrackRepository.findLink(token)
  if (!link.ok) return link
  if (!link.value) return err(documentNotFound())

  const row = link.value
  // Never sent (no frozen version), link turned off, template, archived or
  // deleted: the link no longer serves the document.
  if (
    row.deleted ||
    row.isTemplate ||
    !row.linkEnabled ||
    !row.versionId ||
    row.status === 'ARCHIVED'
  ) {
    return err(documentLinkUnavailable())
  }

  return ok({
    documentId: row.documentId,
    workspaceId: row.workspaceId,
    recipientId: row.recipientId,
    versionId: row.versionId,
  })
}
