import { SD_TONE } from '../sd-tone'

/** Fuso fixo das telas do inventário (o mesmo dos jobs do worker). */
const INVENTORY_TIME_ZONE = 'America/Sao_Paulo'

const DATE_TIME = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: INVENTORY_TIME_ZONE,
})

export function formatInventoryDateTime(iso: string | null): string {
  return iso ? DATE_TIME.format(new Date(iso)) : '—'
}

/** "512 MB", "1,5 GB", "2 TB" — base 1024, a partir de megabytes. */
export function formatMegabytes(mb: number | null | undefined): string {
  if (mb === null || mb === undefined) return '—'
  const fmt = (n: number) =>
    new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(n)
  if (mb >= 1_048_576) return `${fmt(mb / 1_048_576)} TB`
  if (mb >= 1024) return `${fmt(mb / 1024)} GB`
  return `${fmt(mb)} MB`
}

/** Verde até 74%, âmbar até 89%, vermelho a partir de 90%. */
export function usageTone(percent: number | null | undefined): string {
  if (percent === null || percent === undefined) return SD_TONE.slate
  if (percent >= 90) return SD_TONE.red
  if (percent >= 75) return SD_TONE.amber
  return SD_TONE.emerald
}

export const SD_INVENTORY_SOURCE_LABEL = {
  AGENT: 'Agente',
  SNMP: 'SNMP',
} as const

export const SD_INVENTORY_ALERT_KIND_LABEL = {
  DISK: 'Disco',
  RAM: 'Memória',
} as const

export const SD_INVENTORY_SCAN_STATUS_LABEL = {
  SUCCESS: 'Concluída',
  PARTIAL: 'Parcial',
  FAILED: 'Falhou',
} as const
