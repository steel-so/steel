import type { Result } from '@/src/lib/result'

/**
 * The PSP behind the Pix charges. The PSP is not chosen yet, so the app
 * talks to this interface and only a `mock` implementation exists
 * (`./mock-provider`). To add a real PSP, implement it and register it in
 * `./registry`; services never import a concrete provider.
 */

export interface PixProviderChargeInput {
  /** Our transaction id (letters and digits, 26 to 35 chars). */
  txid: string
  /** Amount in reais. */
  amount: number
  /** Text the payer sees (<= 140 chars). */
  description: string
  expiresAt: Date
}

export interface PixProviderCharge {
  /** Id of the charge at the PSP (used by the payment notification). */
  providerChargeId: string
  /** "Copia e cola" payload. */
  brCode: string
}

/** A confirmed payment reported by the PSP. */
export interface PixPaymentNotification {
  providerChargeId: string
  /** Amount received, in reais. */
  paidAmount: number
  paidAt: Date
  endToEndId: string | null
  payerName: string | null
}

export type PixChargeStatus = 'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELLED'

export interface PixProvider {
  /** Stable id stored on each charge (`mock`, later the PSP's name). */
  readonly id: string
  /** True for providers that do not move real money. */
  readonly isTest: boolean
  createCharge(
    input: PixProviderChargeInput,
  ): Promise<Result<PixProviderCharge>>
  /** Stops the charge from being paid. */
  cancelCharge(providerChargeId: string): Promise<Result<void>>
  /**
   * Authenticates a webhook call and returns the payments it carries.
   * `rawBody` is the exact request body (the signature covers it).
   */
  parseWebhook(
    headers: Headers,
    rawBody: string,
    /** Query string of the webhook URL (some PSPs authenticate through it). */
    query?: URLSearchParams,
  ): Result<PixPaymentNotification[]>
  /** Current status at the PSP, for providers that support polling. */
  getChargeStatus?(providerChargeId: string): Promise<Result<PixChargeStatus>>
}
