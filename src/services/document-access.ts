import { type AppError, documentLinkUnavailable } from '@/src/errors/app-error'
import { err, ok, type Result } from '@/src/lib/result'
import { DocumentRepository } from '@/src/repositories/document.repository'
import { DocumentRecipientRepository } from '@/src/repositories/document-recipient.repository'
import { assertModuleEnabled } from './authz'

/**
 * Who a public token (`/d/<token>`) belongs to: a recipient's personal token
 * or the document's generic `publicToken`. Shared by the public link, the
 * analytics beacon and the PDF download (ADR 0063).
 */
export interface DocumentTokenAccess {
  documentId: string
  workspaceId: string
  recipientId: string | null
  /** Version the link shows (the current one). */
  versionId: string | null
}

const MAX_TOKEN_LENGTH = 128

/**
 * `DOCUMENT_LINK_UNAVAILABLE` when the token is unknown, the document was
 * never sent, is a template, archived or deleted, the CRM module is off, or
 * the generic link was turned off (`linkEnabled` governs the generic link;
 * personal links end when the recipient is removed).
 */
export async function resolveDocumentToken(
  token: string,
): Promise<Result<DocumentTokenAccess, AppError>> {
  if (!token || token.length > MAX_TOKEN_LENGTH) {
    return err(documentLinkUnavailable())
  }

  const recipient = await DocumentRecipientRepository.findByToken(token)
  if (!recipient.ok) return recipient

  const target = await DocumentRepository.findLinkTarget(
    recipient.value
      ? { id: recipient.value.documentId }
      : { publicToken: token },
  )
  if (!target.ok) return target

  const document = target.value
  if (
    !document ||
    document.isTemplate ||
    !document.currentVersionId ||
    document.status === 'ARCHIVED' ||
    document.status === 'DRAFT' ||
    (!recipient.value && !document.linkEnabled)
  ) {
    return err(documentLinkUnavailable())
  }

  const enabled = await assertModuleEnabled(document.workspaceId, 'CRM')
  if (!enabled.ok) {
    if (enabled.error.code === 'MODULE_DISABLED') {
      return err(documentLinkUnavailable())
    }
    return enabled
  }

  return ok({
    documentId: document.id,
    workspaceId: document.workspaceId,
    recipientId: recipient.value?.id ?? null,
    versionId: document.currentVersionId,
  })
}
