/**
 * Status-page components and scheduled maintenance: rules that need no I/O.
 */

export const SD_STATUS_COMPONENT_STATES = [
  'OPERATIONAL',
  'DEGRADED',
  'OUTAGE',
] as const
export type SdStatusComponentStateValue =
  (typeof SD_STATUS_COMPONENT_STATES)[number]

export const SD_STATUS_COMPONENT_STATE_LABEL: Record<
  SdStatusComponentStateValue,
  string
> = {
  OPERATIONAL: 'Operacional',
  DEGRADED: 'Desempenho degradado',
  OUTAGE: 'Indisponível',
}

/** Days ahead a public page announces a maintenance window. */
export const SD_STATUS_MAINTENANCE_LOOKAHEAD_DAYS = 14

/** A window may not last longer than this. */
export const SD_STATUS_MAINTENANCE_MAX_DAYS = 30

/** Agent list: windows that ended up to this many days ago still show. */
export const SD_STATUS_MAINTENANCE_HISTORY_DAYS = 7

/** Labels of the public banner. */
export const SD_MAINTENANCE_NOTICE_LABEL = {
  scheduled: 'Agendada',
  inProgress: 'Em andamento',
} as const

export type SdMaintenancePhase =
  | 'SCHEDULED'
  | 'IN_PROGRESS'
  | 'FINISHED'
  | 'CANCELED'

export const SD_MAINTENANCE_PHASE_LABEL: Record<SdMaintenancePhase, string> = {
  SCHEDULED: 'Agendada',
  IN_PROGRESS: 'Em andamento',
  FINISHED: 'Concluída',
  CANCELED: 'Cancelada',
}

export function sdMaintenancePhase(
  window: { startsAt: Date; endsAt: Date; canceledAt: Date | null },
  now: Date,
): SdMaintenancePhase {
  if (window.canceledAt) return 'CANCELED'
  if (window.endsAt.getTime() <= now.getTime()) return 'FINISHED'
  if (window.startsAt.getTime() <= now.getTime()) return 'IN_PROGRESS'
  return 'SCHEDULED'
}

/** `dd/MM/yyyy HH:mm` in the zone of the status page (never the server's). */
export function sdFormatMaintenanceDate(date: Date, timeZone: string): string {
  const format = (zone: string) =>
    new Intl.DateTimeFormat('pt-BR', {
      timeZone: zone,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
      .format(date)
      .replace(', ', ' ')
  try {
    return format(timeZone)
  } catch {
    return format('America/Sao_Paulo')
  }
}

/** Plain-text notice (WhatsApp body). */
export function sdMaintenanceNoticeText(input: {
  pageName: string
  title: string
  kind: 'scheduled' | 'rescheduled' | 'canceled'
  startsAt: Date
  endsAt: Date
  timeZone: string
  description: string | null
  url: string
}): string {
  const head =
    input.kind === 'canceled'
      ? 'Manutenção cancelada'
      : input.kind === 'rescheduled'
        ? 'Manutenção reagendada'
        : 'Manutenção programada'
  const lines = [`*${input.pageName}* — ${head}`, input.title]
  if (input.kind !== 'canceled') {
    lines.push(
      `Quando: ${sdFormatMaintenanceDate(input.startsAt, input.timeZone)} até ${sdFormatMaintenanceDate(input.endsAt, input.timeZone)}`,
    )
  }
  if (input.description) lines.push('', input.description)
  lines.push('', `Acompanhe: ${input.url}`)
  return lines.join('\n')
}

/** Offset (minutes east of UTC) of `zone` at the given instant. */
function zoneOffsetMinutes(at: Date, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at)
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value)
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  )
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000)
}

/**
 * `datetime-local` wall time (`2026-11-10T19:00`) read in `zone` -> ISO
 * instant. Never uses the browser's zone. `null` for an unreadable value.
 */
export function sdWallTimeToIso(local: string, zone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local)
  if (!match) return null
  const [, y, mo, d, h, mi] = match.map(Number)
  const guess = Date.UTC(y, mo - 1, d, h, mi)
  // Two passes settle the offset around DST changes.
  let instant = guess - zoneOffsetMinutes(new Date(guess), zone) * 60_000
  instant = guess - zoneOffsetMinutes(new Date(instant), zone) * 60_000
  return new Date(instant).toISOString()
}

/** ISO instant -> `datetime-local` wall time in `zone`. */
export function sdIsoToWallTime(iso: string, zone: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const shifted = new Date(
    date.getTime() + zoneOffsetMinutes(date, zone) * 60_000,
  )
  return shifted.toISOString().slice(0, 16)
}
