import type {
  WhatsAppArchiveDTO,
  WhatsAppArchiveKind,
  WhatsAppArchiveStatus,
} from '@/types/whatsapp-archive'

/**
 * Labels and formatting of the WhatsApp archive (ADR 0052), shared by the
 * Comunicação settings section and the admin panel. Every date is shown in
 * São Paulo time — the time zone the packages are cut in.
 */

export const ARCHIVE_TIME_ZONE = 'America/Sao_Paulo'

export const ARCHIVE_KIND_LABEL: Record<WhatsAppArchiveKind, string> = {
  WEEKLY: 'Semanal',
  MONTHLY_FULL: 'Completo',
}

export const ARCHIVE_STATUS: Record<
  WhatsAppArchiveStatus,
  {
    label: string
    variant: 'default' | 'secondary' | 'outline' | 'destructive'
  }
> = {
  QUEUED: { label: 'Na fila', variant: 'secondary' },
  RUNNING: { label: 'Gerando', variant: 'secondary' },
  DONE: { label: 'Pronto', variant: 'default' },
  FAILED: { label: 'Falhou', variant: 'destructive' },
}

const dateFormat = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: ARCHIVE_TIME_ZONE,
})

const dateTimeFormat = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: ARCHIVE_TIME_ZONE,
})

export function formatArchiveDate(iso: string): string {
  return dateFormat.format(new Date(iso))
}

export function formatArchiveDateTime(iso: string): string {
  return dateTimeFormat.format(new Date(iso)).replace(',', '')
}

/** `19/10/2026 a 25/10/2026` or `todo o histórico até 30/09/2026`. */
export function formatArchivePeriod(
  archive: Pick<WhatsAppArchiveDTO, 'periodStart' | 'periodEnd'>,
): string {
  const end = formatArchiveDate(archive.periodEnd)
  return archive.periodStart
    ? `${formatArchiveDate(archive.periodStart)} a ${end}`
    : `todo o histórico até ${end}`
}

export function formatArchiveBytes(bytes: number | null): string {
  if (bytes === null) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toLocaleString('pt-BR', {
    maximumFractionDigits: unit === 0 ? 0 : 1,
  })} ${units[unit]}`
}

/** One-line summary of a finished package. */
export function archiveSummary(archive: WhatsAppArchiveDTO): string {
  const parts = [formatArchivePeriod(archive)]
  if (archive.status === 'DONE') {
    parts.push(
      `${archive.atendimentoCount.toLocaleString('pt-BR')} atendimento(s)`,
      `${archive.fileCount.toLocaleString('pt-BR')} arquivo(s)`,
      formatArchiveBytes(archive.sizeBytes),
    )
  }
  return parts.join(' · ')
}
