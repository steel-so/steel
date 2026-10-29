/**
 * Reads an amount typed the Brazilian way ("1.234,50", "150", "R$ 99,9")
 * into reais, or `null` when it is not a positive number with at most two
 * decimals.
 */
export function parsePixAmount(text: string): number | null {
  const cleaned = text.replace(/[R$\s]/g, '')
  if (!cleaned) return null

  let normalized: string
  if (cleaned.includes(',')) {
    // "1.234,50": dots group thousands, the comma is the decimal separator.
    normalized = cleaned.replaceAll('.', '').replace(',', '.')
  } else if (/^\d{1,3}(\.\d{3})+$/.test(cleaned)) {
    // "1.234": a thousands separator, not a decimal point.
    normalized = cleaned.replaceAll('.', '')
  } else {
    normalized = cleaned
  }

  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null
  const value = Number(normalized)
  return value > 0 ? value : null
}

/** Validity choices of the charge dialog, in minutes. */
export const PIX_EXPIRY_OPTIONS = [
  { minutes: 15, label: '15 minutos' },
  { minutes: 30, label: '30 minutos' },
  { minutes: 60, label: '1 hora' },
  { minutes: 360, label: '6 horas' },
  { minutes: 1440, label: '24 horas' },
  { minutes: 4320, label: '3 dias' },
  { minutes: 10080, label: '7 dias' },
] as const

/** The option label for a stored default, or the closest "N minutos". */
export function pixExpiryLabel(minutes: number): string {
  const known = PIX_EXPIRY_OPTIONS.find((option) => option.minutes === minutes)
  return known ? known.label : `${minutes} minutos`
}
