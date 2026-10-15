import { DEFAULT_SITE_TIMEZONE } from '@/src/schemas/site.schema'

/**
 * Dates of blog posts and collection items, formatted in the site's
 * timezone (never the visitor's or the server's): the runtime renders them
 * on the server and the editor previews the same labels.
 */

/** `15 de outubro de 2026` in `timezone` (São Paulo by default). */
export function formatSiteDate(
  iso: string,
  timezone: string = DEFAULT_SITE_TIMEZONE,
): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: timezone,
    }).format(date)
  } catch {
    return new Intl.DateTimeFormat('pt-BR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: DEFAULT_SITE_TIMEZONE,
    }).format(date)
  }
}

/** `15/10/2026 14:30` in `timezone` (editor lists, schedules). */
export function formatSiteDateTime(
  iso: string,
  timezone: string = DEFAULT_SITE_TIMEZONE,
): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const options: Intl.DateTimeFormatOptions = {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      ...options,
      timeZone: timezone,
    }).format(date)
  } catch {
    return new Intl.DateTimeFormat('pt-BR', {
      ...options,
      timeZone: DEFAULT_SITE_TIMEZONE,
    }).format(date)
  }
}

function zoneOffsetMinutes(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date)
  const get = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0)
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  )
  return Math.round((asUtc - date.getTime()) / 60_000)
}

/** `YYYY-MM-DDTHH:mm` (a `datetime-local` value) read in the site's
 * timezone, as an ISO instant; `null` when invalid. */
export function siteLocalToIso(
  value: string,
  timezone: string = DEFAULT_SITE_TIMEZONE,
): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  const [, y, mo, d, h, mi] = match.map(Number)
  const guess = new Date(Date.UTC(y, mo - 1, d, h, mi))
  if (Number.isNaN(guess.getTime())) return null
  // Two passes settle the offset around daylight-saving changes.
  let instant = guess.getTime() - zoneOffsetMinutes(guess, timezone) * 60_000
  instant =
    guess.getTime() - zoneOffsetMinutes(new Date(instant), timezone) * 60_000
  return new Date(instant).toISOString()
}

/** An ISO instant as a `datetime-local` value in the site's timezone. */
export function isoToSiteLocal(
  iso: string,
  timezone: string = DEFAULT_SITE_TIMEZONE,
): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const local = new Date(
    date.getTime() + zoneOffsetMinutes(date, timezone) * 60_000,
  )
  return local.toISOString().slice(0, 16)
}
