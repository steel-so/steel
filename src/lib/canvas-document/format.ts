import { isValidCnpj, isValidCpf } from '@/src/lib/custom-field-value'

/**
 * pt-BR formatting of the `document` catalog: money (BRL), dates in a
 * timezone (the workspace's; São Paulo by default) and the masks of the
 * Brazilian fields. Pure, so the editor, the public link, the PDF and the
 * document service format the same way.
 */

export const DEFAULT_DOCUMENT_TIME_ZONE = 'America/Sao_Paulo'

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

/** `R$ 1.234,56` (Intl puts a no-break space after the symbol). */
export function formatBRL(value: number): string {
  return BRL.format(Number.isFinite(value) ? value : 0)
}

/** `30/11/2026` (or `30/11/2026, 14:05` with `withTime`) in `timeZone`;
 * empty for an invalid date. */
export function formatDocumentDate(
  value: string | Date | null | undefined,
  options: { timeZone?: string; withTime?: boolean } = {},
): string {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      ...(options.withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
      timeZone: options.timeZone ?? DEFAULT_DOCUMENT_TIME_ZONE,
    }).format(date)
  } catch {
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: DEFAULT_DOCUMENT_TIME_ZONE,
    }).format(date)
  }
}

/** "12 dias e 4 horas" until `target` (null once it has passed). */
export function remainingTime(target: Date, now: Date): string | null {
  const ms = target.getTime() - now.getTime()
  if (!Number.isFinite(ms) || ms <= 0) return null
  const minutes = Math.floor(ms / 60_000)
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const mins = minutes % 60
  const plural = (n: number, one: string, many: string) =>
    `${n} ${n === 1 ? one : many}`
  if (days > 0) {
    return hours > 0
      ? `${plural(days, 'dia', 'dias')} e ${plural(hours, 'hora', 'horas')}`
      : plural(days, 'dia', 'dias')
  }
  if (hours > 0) {
    return mins > 0
      ? `${plural(hours, 'hora', 'horas')} e ${plural(mins, 'minuto', 'minutos')}`
      : plural(hours, 'hora', 'horas')
  }
  return plural(Math.max(mins, 1), 'minuto', 'minutos')
}

export function onlyDigits(value: string): string {
  return value.replace(/\D/g, '')
}

/** Progressive CPF mask while typing: `123.456.789-09`. */
export function maskCpf(value: string): string {
  const d = onlyDigits(value).slice(0, 11)
  if (d.length <= 3) return d
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
}

/** Progressive CNPJ mask while typing: `12.345.678/0001-90`. */
export function maskCnpj(value: string): string {
  const d = onlyDigits(value).slice(0, 14)
  if (d.length <= 2) return d
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`
  if (d.length <= 12) {
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`
  }
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
}

/** Progressive phone mask: `(11) 98888-7777` or `(11) 3333-4444`. */
export function maskPhone(value: string): string {
  const d = onlyDigits(value).slice(0, 11)
  if (d.length === 0) return ''
  if (d.length <= 2) return `(${d}`
  const ddd = d.slice(0, 2)
  const rest = d.slice(2)
  if (rest.length <= 4) return `(${ddd}) ${rest}`
  const split = rest.length === 9 ? 5 : 4
  return `(${ddd}) ${rest.slice(0, split)}-${rest.slice(split)}`
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim())
}

export { isValidCnpj, isValidCpf }
