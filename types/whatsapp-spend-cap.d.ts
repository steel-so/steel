/** Monthly spending cap per WhatsApp number (ADR 0064). */

export type WhatsAppSpendCapModeDTO = 'WARN' | 'BLOCK'

/**
 * Where the month spend came from: Meta's own cost, Meta's volume priced
 * with the workspace table, or (no Meta read yet) the Steel ledger only.
 */
export type WhatsAppSpendSourceDTO =
  | 'META_COST'
  | 'META_VOLUME'
  | 'STEEL_LEDGER'

export type WhatsAppSpendCapStatus = 'NO_CAP' | 'ALLOWED' | 'BLOCKED'

export interface WhatsAppSpendCategoryDTO {
  /** Meta pricing category (MARKETING, UTILITY, AUTHENTICATION, SERVICE…). */
  category: string
  label: string
  volume: number
  billableVolume: number
  cost: number
}

export interface WhatsAppSpendCapStatusDTO {
  connectionId: string
  label: string
  phoneNumber: string
  /** Usage month `YYYY-MM` (America/Sao_Paulo). */
  period: string
  currency: string
  /** Cap in BRL; null = no cap. */
  monthlyCapAmount: number | null
  capMode: WhatsAppSpendCapModeDTO | null
  /** Month spend: Meta's closed days + the Steel ledger since then. */
  spent: number
  /** Part reported by Meta (closed UTC days). */
  metaSpent: number
  /** Part counted by the Steel ledger since Meta's last closed day. */
  ledgerSpent: number
  source: WhatsAppSpendSourceDTO
  byCategory: WhatsAppSpendCategoryDTO[]
  /** Last successful Meta read (ISO); null = never read this month. */
  fetchedAt: string | null
  /** End (exclusive, ISO) of the closed days Meta reported. */
  metaPeriodEnd: string | null
  /** The last Meta call failed; the numbers come from the previous read. */
  stale: boolean
  staleReason: string | null
  percent: number | null
  level: 80 | 100 | null
  status: WhatsAppSpendCapStatus
  /** Month-end projection from the current pace. */
  projection: number
  daysElapsed: number
  daysInMonth: number
}
