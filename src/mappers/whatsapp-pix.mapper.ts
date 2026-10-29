import type { WhatsAppPixCharge, WhatsAppPixSettings } from '@prisma/client'
import type {
  WhatsAppPixChargeDTO,
  WhatsAppPixChargeStatusDTO,
  WhatsAppPixSettingsDTO,
} from '@/types/whatsapp-pix'

/** Minutes a charge stays payable when the workspace never chose. */
export const PIX_DEFAULT_EXPIRES_MINUTES = 60

/** A pending charge past its deadline reads as EXPIRED. */
export function effectivePixStatus(
  charge: Pick<WhatsAppPixCharge, 'status' | 'expiresAt'>,
  now: Date = new Date(),
): WhatsAppPixChargeStatusDTO {
  if (charge.status === 'PENDING' && charge.expiresAt <= now) return 'EXPIRED'
  return charge.status
}

export function toWhatsAppPixChargeDTO(
  charge: WhatsAppPixCharge,
  now: Date = new Date(),
): WhatsAppPixChargeDTO {
  return {
    id: charge.id,
    conversationId: charge.conversationId,
    opportunityId: charge.opportunityId,
    createdById: charge.createdById,
    createdByAi: charge.createdByAi,
    provider: charge.provider,
    amount: Number(charge.amount),
    description: charge.description,
    brCode: charge.brCode,
    status: effectivePixStatus(charge, now),
    expiresAt: charge.expiresAt.toISOString(),
    paidAt: charge.paidAt?.toISOString() ?? null,
    paidAmount: charge.paidAmount === null ? null : Number(charge.paidAmount),
    payerName: charge.payerName,
    canceledAt: charge.canceledAt?.toISOString() ?? null,
    createdAt: charge.createdAt.toISOString(),
  }
}

export function toWhatsAppPixSettingsDTO(
  workspaceId: string,
  settings: WhatsAppPixSettings | null,
  provider: { id: string; isTest: boolean },
): WhatsAppPixSettingsDTO {
  return {
    workspaceId,
    enabled: settings?.enabled ?? false,
    defaultExpiresMinutes:
      settings?.defaultExpiresMinutes ?? PIX_DEFAULT_EXPIRES_MINUTES,
    provider: provider.id,
    isTestProvider: provider.isTest,
  }
}
