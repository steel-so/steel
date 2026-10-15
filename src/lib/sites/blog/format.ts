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
