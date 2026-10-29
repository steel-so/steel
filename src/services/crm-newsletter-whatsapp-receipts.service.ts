import type { WhatsAppMessageStatus } from '@prisma/client'
import { logger } from '@/lib/axiom/logger'
import {
  CrmNewsletterWhatsAppRepository,
  type WhatsAppReceipt,
} from '@/src/repositories/crm-newsletter-whatsapp.repository'
import { CrmNewsletterBridge } from './crm-newsletter-bridge.service'

/**
 * Delivery and read receipts of the WhatsApp version of newsletter issues
 * (slice nl3-whatsapp-receipts). The Comunicação status webhooks (Meta and
 * Z-API, normalized by `WhatsAppWebhookService.ingestStatusUpdate`) hand
 * every outbound status here; the matching newsletter recipient — found by
 * the provider message id stored at send time — gets `deliveredAt`,
 * `readAt` or the provider failure, forward only and once. The first read
 * of an issue is also logged on the CRM person's timeline.
 *
 * It never throws and never returns an error: a webhook must keep working
 * even if this side fails, so problems are only logged.
 */

const RECEIPTS: Partial<Record<WhatsAppMessageStatus, WhatsAppReceipt>> = {
  DELIVERED: 'DELIVERED',
  READ: 'READ',
  FAILED: 'FAILED',
}

function describe(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    return String((error as { code: unknown }).code)
  }
  return error instanceof Error ? error.message : String(error)
}

export const CrmNewsletterWhatsAppReceiptsService = {
  /**
   * Applies one provider status. Returns whether a newsletter recipient
   * changed (`false` for other messages, repeats, late or failed updates).
   */
  async onWhatsAppStatus(input: {
    providerMessageId: string
    status: WhatsAppMessageStatus
    at: Date
    /** Provider failure detail (Meta `errors[0]`), for FAILED. */
    error?: string | null
  }): Promise<boolean> {
    const receipt = RECEIPTS[input.status]
    if (!receipt || !input.providerMessageId) return false
    try {
      const found =
        await CrmNewsletterWhatsAppRepository.findByProviderMessageId(
          input.providerMessageId,
        )
      if (!found.ok) throw found.error
      const recipient = found.value
      if (!recipient) return false

      const applied = await CrmNewsletterWhatsAppRepository.applyReceipt(
        recipient.id,
        receipt,
        input.at,
        input.error,
      )
      if (!applied.ok) throw applied.error
      if (!applied.value) return false

      if (receipt === 'FAILED') {
        logger.info('crm.newsletter.whatsapp_failed_receipt', {
          component: 'CrmNewsletterWhatsAppReceipts',
          workspaceId: recipient.workspaceId,
          issueId: recipient.issueId,
          recipientId: recipient.id,
          error: input.error ?? null,
        })
      }
      if (receipt === 'READ') {
        await CrmNewsletterBridge.emit({
          type: 'issue_whatsapp_read',
          subscriberId: recipient.subscriberId,
          issueId: recipient.issueId,
        })
      }
      return true
    } catch (error) {
      logger.warn('crm.newsletter.whatsapp_receipt_failed', {
        component: 'CrmNewsletterWhatsAppReceipts',
        providerMessageId: input.providerMessageId,
        status: input.status,
        error: describe(error),
      })
      return false
    }
  },
}
