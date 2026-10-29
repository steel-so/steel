import { createId } from '@paralleldrive/cuid2'
import type { WhatsAppPixCharge, WhatsAppPixSettings } from '@prisma/client'
import { Prisma } from '@prisma/client'

export function createFakeWhatsAppPixCharge(
  overrides?: Partial<WhatsAppPixCharge>,
): WhatsAppPixCharge {
  const now = new Date()
  const txid = createId()
  return {
    id: createId(),
    workspaceId: createId(),
    conversationId: createId(),
    opportunityId: null,
    createdById: createId(),
    createdByAi: false,
    provider: 'mock',
    providerChargeId: txid,
    amount: new Prisma.Decimal('150.00'),
    description: 'Mensalidade de novembro',
    brCode: `000201mock${txid}`,
    status: 'PENDING',
    expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    paidAt: null,
    paidAmount: null,
    endToEndId: null,
    payerName: null,
    canceledAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export function createFakeWhatsAppPixSettings(
  overrides?: Partial<WhatsAppPixSettings>,
): WhatsAppPixSettings {
  const now = new Date()
  return {
    id: createId(),
    workspaceId: createId(),
    enabled: true,
    defaultExpiresMinutes: 60,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}
