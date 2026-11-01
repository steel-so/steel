import { logger } from '@/lib/axiom/logger'
import { notFound } from '@/src/errors'
import { getBoletoProviderById } from '@/src/lib/boleto/registry'
import { err, ok, type Result } from '@/src/lib/result'
import { CrmProposalPaymentService } from './crm-proposal-payment.service'
import { WhatsAppBoletoService } from './whatsapp-boleto.service'

export const BoletoWebhookService = {
  /**
   * Authenticates a boleto webhook through its provider and settles each
   * change (paid / refunded / expired) on the charge it belongs to: a
   * proposal charge (C6) or a conversation charge (Z1). Notices of unknown
   * charges are logged and acknowledged so the PSP does not retry forever.
   */
  async handle(
    providerId: string,
    headers: Headers,
    rawBody: string,
    query?: URLSearchParams,
  ): Promise<Result<{ received: number; processed: number }>> {
    const provider = getBoletoProviderById(providerId)
    if (!provider.ok) return err(notFound('BoletoProvider'))
    const notifications = provider.value.parseWebhook(headers, rawBody, query)
    if (!notifications.ok) return notifications

    let processed = 0
    for (const notification of notifications.value) {
      const proposal = await CrmProposalPaymentService.handleBoletoNotification(
        providerId,
        notification,
      )
      if (proposal.ok) {
        processed += 1
        continue
      }
      if (proposal.error.code !== 'CRM_PROPOSAL_CHARGE_NOT_FOUND') {
        return proposal
      }

      const chat = await WhatsAppBoletoService.handleNotification(
        providerId,
        notification,
      )
      if (chat.ok) {
        processed += 1
      } else if (chat.error.code !== 'BOLETO_CHARGE_NOT_FOUND') {
        return chat
      } else {
        logger.warn('boleto.webhook_unknown_charge', {
          provider: providerId,
          kind: notification.kind,
          providerChargeId: notification.providerChargeId,
        })
      }
    }
    return ok({ received: notifications.value.length, processed })
  },
}
