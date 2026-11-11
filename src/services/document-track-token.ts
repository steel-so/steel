import { type AppError, documentLinkUnavailable } from '@/src/errors/app-error'
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

const MAX_TOKEN_LENGTH = 128

/**
 * `DOCUMENT_LINK_UNAVAILABLE` when the token is unknown, the document was
 * never sent, is a template, archived or deleted, or the generic link was
 * turned off (`linkEnabled` governs the generic link only).
 */
export async function resolveDocumentToken(
  token: string,
): Promise<Result<ResolvedDocumentToken, AppError>> {
  if (!token || token.length > MAX_TOKEN_LENGTH) {
    return err(documentLinkUnavailable())
  }

  const link = await DocumentTrackRepository.findLink(token)
  if (!link.ok) return link
  const row = link.value
  if (
    !row ||
    row.deleted ||
    row.isTemplate ||
    !row.versionId ||
    row.status === 'ARCHIVED' ||
    (!row.recipientId && !row.linkEnabled)
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
