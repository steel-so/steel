import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { AbacatePayClient } from '@/lib/abacatepay'
import { ABACATE_PAY } from '@/lib/env/server'
import { pixProviderError, pixWebhookInvalid } from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import type { PixChargeStatus, PixProvider } from './provider'

export const ABACATEPAY_PIX_PROVIDER_ID = 'abacatepay'
export const ABACATEPAY_SIGNATURE_HEADER = 'x-webhook-signature'
export const ABACATEPAY_SECRET_PARAM = 'webhookSecret'
export const ABACATEPAY_PAID_EVENT = 'transparent.completed'

/**
 * Public key AbacatePay publishes to sign every webhook body
 * (https://docs.abacatepay.com/pages/webhooks). It is not a secret: it only
 * proves the body was not changed. The origin is proven by the
 * `webhookSecret` query param of the URL registered at AbacatePay.
 */
export const ABACATEPAY_WEBHOOK_PUBLIC_KEY =
  't9dXRhHHo3yDEj5pVDYz0frf7q6bMKyMRmxxCPIPp3RCplBfXRxqlC6ZpiWmOqj4L63qEaeUOtrCI8P0VMUgo6iIga2ri9ogaHFs0WIIywSMg0q7RmBfybe1E5XJcfC4IW3alNqym0tXoAKkzvfEjZxV6bE0oG2zJrNNYmUCKZyV0KZ3JS8Votf9EAWWYdiDkMkpbMdPggfh1EqHlVkMiTady6jOR3hyzGEHrIz2Ret0xHKMbiqkr9HS1JhNHDX9'

/** AbacatePay's minimum charge, in cents. */
const MIN_AMOUNT_CENTS = 100

const PROVIDER_DOWN = 'O provedor de Pix não respondeu. Tente de novo em instantes.'

/** Base64 HMAC-SHA256 of the raw body, as AbacatePay signs it. */
export function signAbacatePayBody(rawBody: string): string {
  return createHmac('sha256', ABACATEPAY_WEBHOOK_PUBLIC_KEY)
    .update(Buffer.from(rawBody, 'utf8'))
    .digest('base64')
}

function safeEqual(expected: string, received: string | null): boolean {
  if (!received) return false
  const a = Buffer.from(expected)
  const b = Buffer.from(received)
  return a.length === b.length && timingSafeEqual(a, b)
}

const ChargeSchema = z.object({
  id: z.string().min(1),
  amount: z.number().optional(),
  paidAmount: z.number().optional(),
  updatedAt: z.string().optional(),
})

const WebhookSchema = z.object({
  event: z.string(),
  data: z
    .object({
      transparent: ChargeSchema.optional(),
      checkout: ChargeSchema.optional(),
      id: z.string().optional(),
      amount: z.number().optional(),
      paidAmount: z.number().optional(),
      updatedAt: z.string().optional(),
      payerInformation: z
        .object({
          PIX: z
            .object({ name: z.string().nullish() })
            .nullish(),
        })
        .nullish(),
    })
    .passthrough(),
})

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
        const response = await AbacatePayClient.createPixCharge({
          amount: cents,
          description: input.description.slice(0, 500),
          expiresIn,
          externalId: input.txid,
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
        const response = await AbacatePayClient.checkPixCharge(providerChargeId)
        if (!response.success || !response.data) {
          return err(pixProviderError(PROVIDER_DOWN))
        }
        return ok(toStatus(response.data.status))
      } catch {
        return err(pixProviderError(PROVIDER_DOWN))
      }
    },

    parseWebhook(headers, rawBody, query) {
      if (!webhookSecret) return err(pixWebhookInvalid())
      if (!safeEqual(webhookSecret, query?.get(ABACATEPAY_SECRET_PARAM) ?? null)) {
        return err(pixWebhookInvalid())
      }
      if (
        !safeEqual(
          signAbacatePayBody(rawBody),
          headers.get(ABACATEPAY_SIGNATURE_HEADER),
        )
      ) {
        return err(pixWebhookInvalid())
      }

      let json: unknown
      try {
        json = JSON.parse(rawBody)
      } catch {
        return err(pixWebhookInvalid())
      }
      const parsed = WebhookSchema.safeParse(json)
      if (!parsed.success) return err(pixWebhookInvalid())

      // Authenticated but not a Pix payment (refund, dispute...): nothing to settle.
      if (parsed.data.event !== ABACATEPAY_PAID_EVENT) return ok([])

      const { data } = parsed.data
      const charge = data.transparent ?? data.checkout ?? data
      const id = charge.id
      if (!id) return err(pixWebhookInvalid())
      const cents = charge.paidAmount ?? charge.amount
      if (cents === undefined) return err(pixWebhookInvalid())
      const paidAt = charge.updatedAt ? new Date(charge.updatedAt) : new Date()

      return ok([
        {
          providerChargeId: id,
          paidAmount: cents / 100,
          paidAt: Number.isNaN(paidAt.getTime()) ? new Date() : paidAt,
          endToEndId: null,
          payerName: data.payerInformation?.PIX?.name ?? null,
        },
      ])
    },
  }
}
