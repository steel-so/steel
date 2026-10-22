const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

const BRL_PRICE = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
})

const INT = new Intl.NumberFormat('pt-BR')

/** R$ 1.234,56 */
export function formatBrl(value: number): string {
  return BRL.format(value)
}

/** Unit prices keep up to 4 decimals (R$ 0,3625). */
export function formatBrlPrice(value: number): string {
  return BRL_PRICE.format(value)
}

export function formatCount(value: number): string {
  return INT.format(value)
}

/** `2026-10-05` -> `05/10`. Pure string work: no browser time zone. */
export function formatShortDay(day: string): string {
  return `${day.slice(8, 10)}/${day.slice(5, 7)}`
}

/** `2026-10-05` -> `05/10/2026`. */
export function formatFullDay(day: string): string {
  return `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`
}

/** Today in the São Paulo calendar (the cost periods' calendar). */
export function todayInSaoPaulo(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

function shift(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export type CostPreset = 'month' | 'previous-month' | '7d' | '30d'

export const COST_PRESET_LABELS: Record<CostPreset, string> = {
  month: 'Este mês',
  'previous-month': 'Mês passado',
  '7d': 'Últimos 7 dias',
  '30d': 'Últimos 30 dias',
}

export function presetRange(
  preset: CostPreset,
  now = new Date(),
): { from: string; to: string } {
  const today = todayInSaoPaulo(now)
  if (preset === 'month') return { from: `${today.slice(0, 7)}-01`, to: today }
  if (preset === '7d') return { from: shift(today, -6), to: today }
  if (preset === '30d') return { from: shift(today, -29), to: today }
  const firstOfMonth = `${today.slice(0, 7)}-01`
  const lastOfPrevious = shift(firstOfMonth, -1)
  return { from: `${lastOfPrevious.slice(0, 7)}-01`, to: lastOfPrevious }
}
