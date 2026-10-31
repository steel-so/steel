import type { Result } from '@/src/lib/result'

/**
 * The PSP behind boleto charges (C6 proposal payment, Z1 conversation
 * charge). Same idea as `PixProvider`: services talk to this interface and
 * pick the concrete provider through `./registry`.
 */

export interface BoletoPayer {
  name: string
  /** CPF or CNPJ, digits only or formatted. */
  taxId: string
  email?: string
  cellphone?: string
}

export interface BoletoChargeInput {
  /** Our reference (idempotency at the PSP). */
  reference: string
  /** Amount in reais. */
  amount: number
  description: string
  payer: BoletoPayer
  /** Due date, YYYY-MM-DD (not in the past, at most 365 days ahead). */
  dueDate?: string
  /** Monthly late interest, in percent (1 = 1%/month). */
  interestPercent?: number
  /** One-time late fine. */
  fine?: { type: 'PERCENTAGE' | 'FIXED'; value: number }
}

export interface BoletoCharge {
  providerChargeId: string
  /** Digitable line (linha digitável). */
  barCode: string
  /** View/print link. */
  url: string | null
  /** Pix alternative printed on the boleto, when the PSP offers it. */
  brCode: string | null
  dueAt: Date | null
}

export type BoletoEventKind = 'PAID' | 'REFUNDED' | 'EXPIRED'

/** A settled/changed boleto reported by the PSP. */
export interface BoletoNotification {
  kind: BoletoEventKind
  providerChargeId: string
  /** Amount in reais, when the PSP sends it. */
  amount: number | null
  at: Date
}

export type BoletoChargeStatus =
  | 'PENDING'
  | 'PAID'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'REFUNDED'

export interface BoletoProvider {
  readonly id: string
  readonly isTest: boolean
  createCharge(input: BoletoChargeInput): Promise<Result<BoletoCharge>>
  getChargeStatus(providerChargeId: string): Promise<Result<BoletoChargeStatus>>
  /** Authenticates a webhook call and returns the changes it carries. */
  parseWebhook(
    headers: Headers,
    rawBody: string,
    query?: URLSearchParams,
  ): Result<BoletoNotification[]>
}
