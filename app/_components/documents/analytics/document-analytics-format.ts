import type { DocumentAnalyticsDTO } from '@/types/document'

/**
 * Formatting of the document reading analytics (pt-BR). Dates are shown in
 * the CRM timezone, never the browser's; days arrive as `YYYY-MM-DD`
 * strings already in that timezone and are formatted from the string.
 */

export const DOCUMENT_ANALYTICS_TIMEZONE = 'America/Sao_Paulo'

const MONTHS = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
]

const integer = new Intl.NumberFormat('pt-BR')
const percent = new Intl.NumberFormat('pt-BR', {
  style: 'percent',
  maximumFractionDigits: 0,
})
const dateTime = new Intl.DateTimeFormat('pt-BR', {
  timeZone: DOCUMENT_ANALYTICS_TIMEZONE,
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

export function formatCount(value: number): string {
  return integer.format(value)
}

/** `0.42` → "42%". */
export function formatRate(value: number): string {
  return percent.format(value)
}

/** "45 s", "3 min 20 s", "1 h 05 min". */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    const rest = seconds % 60
    return rest ? `${minutes} min ${rest} s` : `${minutes} min`
  }
  const hours = Math.floor(minutes / 60)
  return `${hours} h ${String(minutes % 60).padStart(2, '0')} min`
}

/** "11 nov" from `2026-11-11`. */
export function formatDay(day: string): string {
  const [, month, date] = day.split('-')
  return `${Number(date)} ${MONTHS[Number(month) - 1] ?? ''}`
}

/** "11 de nov., 14:32" in the CRM timezone. */
export function formatSeenAt(iso: string): string {
  return dateTime.format(new Date(iso))
}

const DEVICE_LABELS: Record<string, string> = {
  desktop: 'Computador',
  tablet: 'Tablet',
  mobile: 'Celular',
  unknown: 'Não identificado',
}

export function deviceLabel(device: string | null): string {
  return DEVICE_LABELS[device ?? 'unknown'] ?? DEVICE_LABELS.unknown
}

type Reader = DocumentAnalyticsDTO['readers'][number]
type Section = DocumentAnalyticsDTO['sections'][number]

/** Recipient name, or "Visitante anônimo" for the generic link. */
export function readerName(reader: Reader): string {
  return reader.name ?? 'Visitante anônimo'
}

/** Short, stable tag of the browser ("#3f9a1c"), to tell readers apart. */
export function visitorTag(visitorId: string): string {
  return `#${visitorId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6)}`
}

/**
 * Where readers drop off: the biggest fall in reach between one section
 * and the next. `null` when no section loses at least 10 points.
 */
export function biggestDropOff(
  sections: Section[],
): { from: Section; to: Section; drop: number } | null {
  let best: { from: Section; to: Section; drop: number } | null = null
  for (let i = 1; i < sections.length; i++) {
    const from = sections[i - 1]
    const to = sections[i]
    const drop = from.reachRate - to.reachRate
    if (drop >= 0.1 && (!best || drop > best.drop)) best = { from, to, drop }
  }
  return best
}
