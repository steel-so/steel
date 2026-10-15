/**
 * Dates of the Sites screens. Workspaces have no timezone of their own, so
 * like the rest of the CRM they read in São Paulo time — never the
 * browser's, so CI (UTC) and every user see the same text.
 */
export const SITE_TIME_ZONE = 'America/Sao_Paulo'

const dateTime = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: SITE_TIME_ZONE,
})

/** "15 de out. de 2026, 14:32". */
export function formatSiteDate(iso: string): string {
  return dateTime.format(new Date(iso))
}

/** "agora", "há 5 min", "há 3 h", "há 2 dias" or the date. */
export function formatSiteRelative(iso: string, now = Date.now()): string {
  const diff = Math.max(0, now - new Date(iso).getTime())
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return 'agora'
  if (minutes < 60) return `há ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `há ${hours} h`
  const days = Math.floor(hours / 24)
  if (days < 7) return days === 1 ? 'há 1 dia' : `há ${days} dias`
  return formatSiteDate(iso)
}

/** "182 KB" / "1,2 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toLocaleString('pt-BR', {
    maximumFractionDigits: 1,
  })} MB`
}
