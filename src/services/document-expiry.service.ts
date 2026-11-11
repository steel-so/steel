import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { baseEmailUrl } from '@/lib/base-email-url'
import {
  formatProposalValidity,
  isProposalValidityPast,
} from '@/src/lib/crm-proposal-validity'
import { sendDocumentExpiredEmail } from '@/src/lib/mail/documents/send-document-emails'
import { ok, type Result } from '@/src/lib/result'
import { DocumentRepository } from '@/src/repositories/document.repository'
import {
  CrmSettingsService,
  type ResolvedCrmSettings,
} from './crm-settings.service'
import { documentPath, notifyDocumentExpired } from './document-notifications'

export interface DocumentExpiryTick {
  candidates: number
  expired: number
  notified: number
}

/**
 * Daily job (`documents-expiry`, 00:10 America/Sao_Paulo): SENT/VIEWED
 * documents whose validity ended (it covers the whole last day, São Paulo)
 * become EXPIRED with a timeline event; the owner gets an in-app
 * notification and, when the workspace keeps the expiry e-mail on (same CRM
 * switch as the legacy proposals), an e-mail. An e-mail failure never stops
 * the batch.
 */
export const DocumentExpiryService = {
  async expireDue(now: Date = new Date()): Promise<Result<DocumentExpiryTick>> {
    const candidates = await DocumentRepository.listExpirationCandidates(now)
    if (!candidates.ok) return candidates

    const settingsByWorkspace = new Map<string, ResolvedCrmSettings>()
    let expired = 0
    let notified = 0

    for (const doc of candidates.value) {
      if (!isProposalValidityPast(doc.validUntil, now)) continue

      const marked = await DocumentRepository.markExpired(doc.id, now)
      if (!marked.ok) {
        logger.error('documents.expiry.expire_failed', {
          documentId: doc.id,
          workspaceId: doc.workspaceId,
          reason: marked.error.code,
        })
        continue
      }
      if (!marked.value) continue
      expired += 1

      auditMutation({
        entity: 'document',
        action: 'update',
        actorId: null,
        targetId: doc.id,
        meta: { status: 'EXPIRED', via: 'documents-expiry' },
      })
      await notifyDocumentExpired({
        workspaceId: doc.workspaceId,
        document: { id: doc.id, title: doc.title, ownerId: doc.ownerId },
        expiredAt: now,
      })

      let settings = settingsByWorkspace.get(doc.workspaceId)
      if (!settings) {
        const resolved = await CrmSettingsService.resolve(doc.workspaceId)
        if (!resolved.ok) continue
        settings = resolved.value
        settingsByWorkspace.set(doc.workspaceId, settings)
      }
      if (!settings.notifyProposalExpiry) continue

      try {
        await sendDocumentExpiredEmail({
          to: doc.owner.email,
          username: doc.owner.name,
          documentTitle: doc.title,
          workspaceName: doc.workspace.name,
          validUntil: doc.validUntil
            ? formatProposalValidity(doc.validUntil)
            : '',
          documentUrl: `${baseEmailUrl}/${doc.workspace.slug}${documentPath(doc.id)}`,
        })
        notified += 1
      } catch (error) {
        logger.warn('documents.expiry.email_failed', {
          documentId: doc.id,
          workspaceId: doc.workspaceId,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }

    return ok({ candidates: candidates.value.length, expired, notified })
  },
}
