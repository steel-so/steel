const PERCENT = new Intl.NumberFormat('pt-BR', {
  style: 'percent',
  maximumFractionDigits: 0,
})

/** Money or "—" when the metric does not exist (no spend, no volume). */
export function formatAdMoney(
  value: number | null,
  format: (amount: number) => string,
): string {
  return value === null ? '—' : format(value)
}

/** ROI as a signed percentage ("+120%", "-35%"); "—" without spend. */
export function formatRoi(roi: number | null): string {
  if (roi === null) return '—'
  const text = PERCENT.format(roi)
  return roi > 0 ? `+${text}` : text
}

/** Parses "1.234,56" / "1234.56" into a number; undefined when invalid. */
export function parseAdAmount(text: string): number | undefined {
  const trimmed = text.trim()
  if (!trimmed) return undefined
  const normalized = trimmed.includes(',')
    ? trimmed.replaceAll('.', '').replace(',', '.')
    : trimmed
  const value = Number(normalized)
  return Number.isFinite(value) && value >= 0 ? value : undefined
}
