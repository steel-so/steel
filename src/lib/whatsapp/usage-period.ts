import {
  WHATSAPP_USAGE_THRESHOLDS,
  type WhatsAppUsageThreshold,
} from '@/src/schemas/whatsapp-usage.schema'

const PERIOD_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
})

/**
 * `YYYY-MM` of the Communication usage month. São Paulo calendar (not UTC
 * like the AI quota): the limit is a business budget for Brazilian teams, so
 * the month must not turn at 21:00 on its last day.
 */
export function whatsappUsagePeriod(now = new Date()): string {
  const parts = PERIOD_FORMAT.formatToParts(now)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  return `${year}-${month}`
}

/**
 * The highest alert threshold (50/80/100%) that the move `previous → current`
 * crossed, or `null`. A threshold is reached at `ceil(limit × pct / 100)`
 * units, so each one fires exactly once per counter as it grows.
 */
export function crossedUsageThreshold(
  previous: number,
  current: number,
  limit: number | null,
): WhatsAppUsageThreshold | null {
  if (!limit || limit <= 0) return null
  let crossed: WhatsAppUsageThreshold | null = null
  for (const threshold of WHATSAPP_USAGE_THRESHOLDS) {
    const mark = Math.ceil((limit * threshold) / 100)
    if (previous < mark && current >= mark) crossed = threshold
  }
  return crossed
}
