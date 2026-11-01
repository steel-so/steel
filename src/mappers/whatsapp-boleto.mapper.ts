import type { WhatsAppBoletoCharge } from '@prisma/client'
import type {
  WhatsAppBoletoChargeDTO,
  WhatsAppBoletoChargeStatusDTO,
  WhatsAppBoletoSettingsDTO,
} from '@/types/whatsapp-boleto'

/** A pending charge past its due date reads as EXPIRED. */
export function effectiveBoletoStatus(
  charge: Pick<WhatsAppBoletoCharge, 'status' | 'dueAt'>,
  now: Date = new Date(),
): WhatsAppBoletoChargeStatusDTO {
  if (charge.status === 'PENDING' && charge.dueAt <= now) return 'EXPIRED'
  return charge.status
}

export function toWhatsAppBoletoChargeDTO(
  charge: WhatsAppBoletoCharge,
  now: Date = new Date(),
): WhatsAppBoletoChargeDTO {
  return {
    id: charge.id,
    conversationId: charge.conversationId,
    opportunityId: charge.opportunityId,
    createdById: charge.createdById,
    provider: charge.provider,
    amount: Number(charge.amount),
    description: charge.description,
    payerName: charge.payerName,
    barCode: charge.barCode,
    url: charge.url,
    dueAt: charge.dueAt.toISOString(),
    status: effectiveBoletoStatus(charge, now),
    paidAt: charge.paidAt?.toISOString() ?? null,
    paidAmount: charge.paidAmount === null ? null : Number(charge.paidAmount),
    canceledAt: charge.canceledAt?.toISOString() ?? null,
    createdAt: charge.createdAt.toISOString(),
  }
}

export function toWhatsAppBoletoSettingsDTO(
  workspaceId: string,
  enabled: boolean,
  provider: { id: string; isTest: boolean },
): WhatsAppBoletoSettingsDTO {
  return {
    workspaceId,
    enabled,
    provider: provider.id,
    isTestProvider: provider.isTest,
  }
}
