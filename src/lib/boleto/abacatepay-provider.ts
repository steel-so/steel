import { AbacatePayTransparent } from '@/lib/abacatepay'
import { ABACATE_PAY } from '@/lib/env/server'
import { boletoProviderError, boletoWebhookInvalid } from '@/src/errors'
import { readAbacatePayWebhook } from '@/src/lib/abacatepay-webhook'
import { err, ok } from '@/src/lib/result'
import type {
  BoletoChargeStatus,
  BoletoEventKind,
  BoletoProvider,
} from './provider'

export const ABACATEPAY_BOLETO_PROVIDER_ID = 'abacatepay'

const MIN_AMOUNT_CENTS = 100
const PROVIDER_DOWN =
  'O provedor de boleto não respondeu. Tente de novo em instantes.'

/** Webhook events that change a transparent charge (`transparent.*`). */
const EVENT_KINDS: Record<string, BoletoEventKind> = {
  'transparent.completed': 'PAID',
  'transparent.refunded': 'REFUNDED',
  'transparent.expired': 'EXPIRED',
}

function toStatus(status: string): BoletoChargeStatus {
  if (status === 'PAID') return 'PAID'
  if (status === 'EXPIRED') return 'EXPIRED'
  if (status === 'CANCELLED') return 'CANCELLED'
  if (status === 'REFUNDED') return 'REFUNDED'
  return 'PENDING'
}

/**
 * Real boleto through AbacatePay API v2 (`method: BOLETO`). AbacatePay
 * documents neither a cancel route nor an expiry event: an unpaid boleto
 * turns `EXPIRED` after the due date (read it with `getChargeStatus`; the
 * webhook map also accepts `transparent.expired` in case it is sent).
 */
export function createAbacatePayBoletoProvider(
  webhookSecret?: string,
): BoletoProvider {
  return {
    id: ABACATEPAY_BOLETO_PROVIDER_ID,
    isTest: false,

    async createCharge(input) {
      if (!ABACATE_PAY) {
        return err(boletoProviderError('AbacatePay não está configurado'))
      }
      const cents = Math.round(input.amount * 100)
      if (cents < MIN_AMOUNT_CENTS) {
        return err(boletoProviderError('O valor mínimo do boleto é R$ 1,00'))
      }
      try {
        const response = await AbacatePayTransparent.create({
          method: 'BOLETO',
          data: {
            amount: cents,
            customer: {
              name: input.payer.name,
              taxId: input.payer.taxId,
              ...(input.payer.email ? { email: input.payer.email } : {}),
              ...(input.payer.cellphone
                ? { cellphone: input.payer.cellphone }
                : {}),
            },
            description: input.description.slice(0, 500),
            externalId: input.reference,
            ...(input.dueDate ? { dueDate: input.dueDate } : {}),
            ...(input.interestPercent
              ? { interest: { value: Math.round(input.interestPercent * 100) } }
              : {}),
            ...(input.fine
              ? {
                  fine: {
                    type: input.fine.type,
                    // PERCENTAGE: hundredths of a percent; FIXED: cents.
                    value: Math.round(input.fine.value * 100),
                  },
                }
              : {}),
          },
        })
        const charge = response.data
        if (!response.success || !charge?.id || !charge.barCode) {
          return err(boletoProviderError(response.error ?? PROVIDER_DOWN))
        }
        return ok({
          providerChargeId: charge.id,
          barCode: charge.barCode,
          url: charge.url ?? null,
          brCode: charge.brCode ?? null,
          dueAt: charge.expiresAt ? new Date(charge.expiresAt) : null,
        })
      } catch {
        return err(boletoProviderError(PROVIDER_DOWN))
      }
    },

    async getChargeStatus(providerChargeId) {
      try {
        const response = await AbacatePayTransparent.check(providerChargeId)
        if (!response.success || !response.data) {
          return err(boletoProviderError(PROVIDER_DOWN))
        }
        return ok(toStatus(response.data.status))
      } catch {
        return err(boletoProviderError(PROVIDER_DOWN))
      }
    },

    parseWebhook(headers, rawBody, query) {
      const event = readAbacatePayWebhook(webhookSecret, headers, rawBody, query)
      if (!event) return err(boletoWebhookInvalid())
      const kind = EVENT_KINDS[event.event]
      if (!kind) return ok([])
      if (!event.chargeId) return err(boletoWebhookInvalid())
      return ok([
        {
          kind,
          providerChargeId: event.chargeId,
          amount: event.cents === null ? null : event.cents / 100,
          at: event.at,
        },
      ])
    },
  }
}
