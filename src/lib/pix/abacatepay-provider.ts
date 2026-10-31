import { AbacatePayTransparent } from '@/lib/abacatepay'
import { ABACATE_PAY } from '@/lib/env/server'
import { pixProviderError, pixWebhookInvalid } from '@/src/errors'
import { readAbacatePayWebhook } from '@/src/lib/abacatepay-webhook'
import { err, ok } from '@/src/lib/result'
import type { PixChargeStatus, PixProvider } from './provider'

export const ABACATEPAY_PIX_PROVIDER_ID = 'abacatepay'
export const ABACATEPAY_PAID_EVENT = 'transparent.completed'

/** AbacatePay's minimum charge, in cents. */
const MIN_AMOUNT_CENTS = 100

const PROVIDER_DOWN = 'O provedor de Pix não respondeu. Tente de novo em instantes.'

function toStatus(status: string): PixChargeStatus {
  if (status === 'PAID') return 'PAID'
  if (status === 'EXPIRED') return 'EXPIRED'
  if (status === 'CANCELLED') return 'CANCELLED'
  return 'PENDING'
}

/**
 * Real Pix through AbacatePay (`/transparents`). Needs the `ABACATE_PAY` API
 * key (a dev key issues sandbox charges) and `webhookSecret`, the value the
 * workspace owner put in the webhook URL (`PIX_WEBHOOK_SECRET`).
 *
 * AbacatePay documents no cancel route: `cancelCharge` is a no-op and the
 * charge simply expires at `expiresIn`.
 */
export function createAbacatePayPixProvider(webhookSecret?: string): PixProvider {
  return {
    id: ABACATEPAY_PIX_PROVIDER_ID,
    isTest: false,

    async createCharge(input) {
      if (!ABACATE_PAY) {
        return err(pixProviderError('AbacatePay não está configurado'))
      }
      const cents = Math.round(input.amount * 100)
      if (cents < MIN_AMOUNT_CENTS) {
        return err(pixProviderError('O valor mínimo do Pix é R$ 1,00'))
      }
      const expiresIn = Math.max(
        60,
        Math.round((input.expiresAt.getTime() - Date.now()) / 1000),
      )
      try {
        const response = await AbacatePayTransparent.create({
          method: 'PIX',
          data: {
            amount: cents,
            description: input.description.slice(0, 500),
            expiresIn,
            externalId: input.txid,
          },
        })
        const charge = response.data
        if (!response.success || !charge?.id || !charge.brCode) {
          return err(pixProviderError(PROVIDER_DOWN))
        }
        return ok({ providerChargeId: charge.id, brCode: charge.brCode })
      } catch {
        return err(pixProviderError(PROVIDER_DOWN))
      }
    },

    async cancelCharge() {
      return ok(undefined)
    },

    async getChargeStatus(providerChargeId) {
      try {
        const response = await AbacatePayTransparent.check(providerChargeId)
        if (!response.success || !response.data) {
          return err(pixProviderError(PROVIDER_DOWN))
        }
        return ok(toStatus(response.data.status))
      } catch {
        return err(pixProviderError(PROVIDER_DOWN))
      }
    },

    parseWebhook(headers, rawBody, query) {
      const event = readAbacatePayWebhook(webhookSecret, headers, rawBody, query)
      if (!event) return err(pixWebhookInvalid())
      // Authenticated but not a Pix payment (refund, dispute...): nothing to settle.
      if (event.event !== ABACATEPAY_PAID_EVENT) return ok([])
      if (!event.chargeId || event.cents === null) {
        return err(pixWebhookInvalid())
      }
      return ok([
        {
          providerChargeId: event.chargeId,
          paidAmount: event.cents / 100,
          paidAt: event.at,
          endToEndId: null,
          payerName: event.payerName,
        },
      ])
    },
  }
}
