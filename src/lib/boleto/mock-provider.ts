import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { boletoWebhookInvalid } from '@/src/errors'
import { err, ok } from '@/src/lib/result'
import type { BoletoProvider } from './provider'

export const MOCK_BOLETO_PROVIDER_ID = 'mock'
export const MOCK_BOLETO_SIGNATURE_HEADER = 'x-boleto-signature'

export function signMockBoletoBody(secret: string, rawBody: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex')
}

const MockWebhookSchema = z.object({
  kind: z.enum(['PAID', 'REFUNDED', 'EXPIRED']),
  providerChargeId: z.string().min(1).max(64),
  amount: z.number().min(0).optional(),
  at: z.iso.datetime().optional(),
})

/** Test provider: well-formed fake digitable line, no network. */
export function createMockBoletoProvider(webhookSecret?: string): BoletoProvider {
  return {
    id: MOCK_BOLETO_PROVIDER_ID,
    isTest: true,

    async createCharge(input) {
      const digits = input.reference.replace(/\D/g, '').padEnd(10, '0')
      return ok({
        providerChargeId: input.reference,
        barCode: `00000.00000 00000.000000 ${digits.slice(0, 5)}.${digits.slice(5, 10)} 0 00000000000000`,
        url: null,
        brCode: null,
        dueAt: input.dueDate ? new Date(`${input.dueDate}T23:59:59.999Z`) : null,
      })
    },

    async getChargeStatus() {
      return ok('PENDING')
    },

    parseWebhook(headers, rawBody) {
      if (!webhookSecret) return err(boletoWebhookInvalid())
      const expected = Buffer.from(signMockBoletoBody(webhookSecret, rawBody))
      const received = Buffer.from(
        headers.get(MOCK_BOLETO_SIGNATURE_HEADER) ?? '',
      )
      if (
        expected.length !== received.length ||
        !timingSafeEqual(expected, received)
      ) {
        return err(boletoWebhookInvalid())
      }
      let json: unknown
      try {
        json = JSON.parse(rawBody)
      } catch {
        return err(boletoWebhookInvalid())
      }
      const parsed = MockWebhookSchema.safeParse(json)
      if (!parsed.success) return err(boletoWebhookInvalid())
      return ok([
        {
          kind: parsed.data.kind,
          providerChargeId: parsed.data.providerChargeId,
          amount: parsed.data.amount ?? null,
          at: parsed.data.at ? new Date(parsed.data.at) : new Date(),
        },
      ])
    },
  }
}
