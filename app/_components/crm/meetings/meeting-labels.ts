import type { CrmMeetingFormat } from '@/types/crm-meeting'

export const WEEKDAYS: Array<{ key: string; label: string }> = [
  { key: '1', label: 'Segunda' },
  { key: '2', label: 'Terça' },
  { key: '3', label: 'Quarta' },
  { key: '4', label: 'Quinta' },
  { key: '5', label: 'Sexta' },
  { key: '6', label: 'Sábado' },
  { key: '0', label: 'Domingo' },
]

export const FORMAT_LABEL: Record<CrmMeetingFormat, string> = {
  ONLINE: 'Online',
  IN_PERSON: 'Presencial',
}

export const COMMON_TIMEZONES = [
  'America/Sao_Paulo',
  'America/Manaus',
  'America/Fortaleza',
  'America/Cuiaba',
  'America/Rio_Branco',
  'America/Noronha',
  'UTC',
] as const

/** `Intl` in the page's own zone, never the browser's. */
export function formatWhen(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

export function publicUrl(slug: string): string {
  return `${window.location.origin}/m/${slug}`
}

export function embedCode(slug: string): string {
  return `<iframe src="${window.location.origin}/m/${slug}/embed" title="Agendar reunião" width="100%" height="760" style="border:0;max-width:640px"></iframe>`
}
