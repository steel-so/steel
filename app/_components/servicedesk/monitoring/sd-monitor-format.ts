import type { SdMonitorAlertDTO } from '@/types/sd-monitor'

/** Fuso fixo do produto: o servidor roda em UTC e o navegador pode divergir. */
const DATE_TIME = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
})

export function formatMonitorDateTime(value: string | null): string {
  return value ? DATE_TIME.format(new Date(value)) : '—'
}

export const SD_MONITOR_ALERT_STATUS_LABEL: Record<
  SdMonitorAlertDTO['status'],
  string
> = {
  OPEN: 'Aberto',
  RESOLVED: 'Normalizado',
  IGNORED: 'Ignorado',
}
