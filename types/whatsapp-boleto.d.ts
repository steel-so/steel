/** `EXPIRED` is derived: a pending charge past `dueAt`. */
export type WhatsAppBoletoChargeStatusDTO =
  | 'PENDING'
  | 'PAID'
  | 'EXPIRED'
  | 'CANCELED'
  | 'REFUNDED'

export interface WhatsAppBoletoChargeDTO {
  id: string
  conversationId: string
  opportunityId: string | null
  createdById: string | null
  provider: string
  /** Amount in reais. */
  amount: number
  description: string
  payerName: string
  /** Digitable line. */
  barCode: string
  /** View/print link at the PSP. */
  url: string | null
  dueAt: string
  status: WhatsAppBoletoChargeStatusDTO
  paidAt: string | null
  paidAmount: number | null
  canceledAt: string | null
  createdAt: string
}

export interface WhatsAppBoletoSettingsDTO {
  workspaceId: string
  enabled: boolean
  /** Active PSP; `mock` boletos are not real money. */
  provider: string
  isTestProvider: boolean
}
