import { logger } from '@/lib/axiom/logger'
import { notFound } from '@/src/errors'
import { getBoletoProviderById } from '@/src/lib/boleto/registry'
import { err, ok, type Result } from '@/src/lib/result'

export const BoletoWebhookService = {
  /**
   * Authenticates a boleto webhook through its provider and reports each
   * change (paid / refunded / expired). Settling a charge in a feature
   * (proposal payment, conversation charge) hooks in here once its table
   * exists; until then the change is logged and acknowledged.
   */
  async handle(
    providerId: string,
    headers: Headers,
    rawBody: string,
    query?: URLSearchParams,
  ): Promise<Result<{ received: number }>> {
    const provider = getBoletoProviderById(providerId)
    if (!provider.ok) return err(notFound('BoletoProvider'))
    const notifications = provider.value.parseWebhook(headers, rawBody, query)
    if (!notifications.ok) return notifications

    for (const notification of notifications.value) {
      logger.info('boleto.webhook_received', {
        provider: providerId,
        kind: notification.kind,
        providerChargeId: notification.providerChargeId,
      })
    }
    return ok({ received: notifications.value.length })
  },
}
