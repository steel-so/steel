/** `EXPIRED` is derived: a pending charge past `expiresAt`. */
export type WhatsAppPixChargeStatusDTO =
  | 'PENDING'
  | 'PAID'
  | 'EXPIRED'
  | 'CANCELED'

export interface WhatsAppPixChargeDTO {
  id: string
  conversationId: string
  opportunityId: string | null
  /** Agent who sent it; null when the AI did. */
  createdById: string | null
  createdByAi: boolean
  /** PSP that issued the charge (`mock` while none is contracted). */
  provider: string
  /** Amount in reais. */
  amount: number
  description: string
  /** "Copia e cola" payload. */
  brCode: string
  status: WhatsAppPixChargeStatusDTO
  expiresAt: string
  paidAt: string | null
  paidAmount: number | null
  payerName: string | null
  canceledAt: string | null
  createdAt: string
}

export interface WhatsAppPixSettingsDTO {
  workspaceId: string
  enabled: boolean
  defaultExpiresMinutes: number
  /** Active PSP; `mock` charges are not real money. */
  provider: string
  /** True while the provider is the mock one. */
  isTestProvider: boolean
}
