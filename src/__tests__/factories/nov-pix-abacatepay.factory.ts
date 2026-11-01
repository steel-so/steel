import { createId } from '@paralleldrive/cuid2'
import type { WhatsAppBoletoCharge } from '@prisma/client'
import { Prisma } from '@prisma/client'

export function createFakeWhatsAppBoletoCharge(
  overrides?: Partial<WhatsAppBoletoCharge>,
): WhatsAppBoletoCharge {
  const now = new Date()
  return {
    id: createId(),
    workspaceId: createId(),
    conversationId: createId(),
    opportunityId: null,
    createdById: createId(),
    provider: 'mock',
    providerChargeId: createId(),
    amount: new Prisma.Decimal('250.00'),
    description: 'Mensalidade de novembro',
    payerName: 'Maria da Silva',
    payerTaxId: '11144477735',
    barCode: '00000.00000 00000.000000 00000.000000 0 00000000000000',
    url: 'https://pay.example.com/boleto/1',
    dueAt: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000),
    status: 'PENDING',
    paidAt: null,
    paidAmount: null,
    canceledAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}
