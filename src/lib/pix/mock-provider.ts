import { createHmac, timingSafeEqual } from 'node:crypto'
import { pixWebhookInvalid } from '@/src/errors'
import { err, ok } from '@/src/lib/result'
import { MockPixWebhookSchema } from '@/src/schemas/whatsapp-pix.schema'
import { buildBrCode } from './br-code'
import type { PixProvider } from './provider'

export const MOCK_PIX_PROVIDER_ID = 'mock'
export const MOCK_PIX_SIGNATURE_HEADER = 'x-pix-signature'

/** Hex HMAC-SHA256 of the body, as the mock webhook expects it. */
export function signMockPixBody(secret: string, rawBody: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex')
}

function signatureMatches(expected: string, received: string | null): boolean {
  if (!received) return false
  const a = Buffer.from(expected)
  const b = Buffer.from(received)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Test provider: issues a well-formed BR Code that no bank can settle, never
 * calls a network and accepts payments only through its signed webhook (or
 * the "simulate payment" action of the app).
 */
export function createMockPixProvider(webhookSecret?: string): PixProvider {
  return {
    id: MOCK_PIX_PROVIDER_ID,
    isTest: true,

    async createCharge(input) {
      return ok({
        providerChargeId: input.txid,
        brCode: buildBrCode({
          key: 'teste-pix@steel.invalid',
          amount: input.amount,
          merchantName: 'Steel Pix Teste',
          merchantCity: 'Sao Paulo',
          txid: input.txid,
        }),
      })
    },

    async cancelCharge() {
      return ok(undefined)
    },

    parseWebhook(headers, rawBody) {
      if (!webhookSecret) return err(pixWebhookInvalid())
      const expected = signMockPixBody(webhookSecret, rawBody)
      if (!signatureMatches(expected, headers.get(MOCK_PIX_SIGNATURE_HEADER))) {
        return err(pixWebhookInvalid())
      }

      let json: unknown
      try {
        json = JSON.parse(rawBody)
      } catch {
        return err(pixWebhookInvalid())
      }
      const parsed = MockPixWebhookSchema.safeParse(json)
      if (!parsed.success) return err(pixWebhookInvalid())

      return ok([
        {
          providerChargeId: parsed.data.providerChargeId,
          paidAmount: parsed.data.paidAmount,
          paidAt: parsed.data.paidAt
            ? new Date(parsed.data.paidAt)
            : new Date(),
          endToEndId: parsed.data.endToEndId ?? null,
          payerName: parsed.data.payerName ?? null,
        },
      ])
    },
  }
}
