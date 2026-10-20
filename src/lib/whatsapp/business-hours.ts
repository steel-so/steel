/**
 * Horário de atendimento do WhatsApp (Comunicação): fora dele nenhum envio
 * de atendente, da IA ou do disparo automático sai. Horários em
 * America/Sao_Paulo, como o resto do módulo.
 */
export const WHATSAPP_BUSINESS_HOURS_TIME_ZONE = 'America/Sao_Paulo'

/** `HH:mm`, 24 h. */
export const BUSINESS_HOURS_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

export interface WhatsAppBusinessHours {
  enabled: boolean
  /** `HH:mm` — start of the day's window. */
  start: string
  /** `HH:mm` — end of the window (exclusive). Before `start` = overnight. */
  end: string
  /** Weekdays with service, 0 = Sunday … 6 = Saturday. */
  days: number[]
}

const MINUTE_MS = 60 * 1000
const DAY_MINUTES = 24 * 60

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: WHATSAPP_BUSINESS_HOURS_TIME_ZONE,
  hourCycle: 'h23',
  weekday: 'short',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Weekday and minute of the day of `date` in the business time zone. */
function localClock(date: Date): { weekday: number; minute: number } {
  const parts = Object.fromEntries(
    partsFormatter.formatToParts(date).map((part) => [part.type, part.value]),
  )
  return {
    weekday: WEEKDAYS.indexOf(parts.weekday),
    minute: Number(parts.hour) * 60 + Number(parts.minute),
  }
}

/**
 * Whether `now` is inside the window. The window opens on each service day
 * at `start`; an overnight window (end <= start) runs into the next day.
 */
export function isWithinBusinessHours(
  hours: WhatsAppBusinessHours,
  now: Date,
): boolean {
  if (!hours.enabled) return true
  const start = toMinutes(hours.start)
  const end = toMinutes(hours.end)
  const { weekday, minute } = localClock(now)
  const days = new Set(hours.days)

  if (start === end) return days.has(weekday) // whole day
  if (start < end) {
    return days.has(weekday) && minute >= start && minute < end
  }
  // Overnight: today's evening part, or the morning tail of yesterday's.
  const yesterday = (weekday + 6) % 7
  return (
    (days.has(weekday) && minute >= start) ||
    (days.has(yesterday) && minute < end)
  )
}

/**
 * Next moment the window is open (minute precision), or `now` when it
 * already is. `null` when no weekday is selected (never opens).
 */
export function nextBusinessOpening(
  hours: WhatsAppBusinessHours,
  now: Date,
): Date | null {
  if (isWithinBusinessHours(hours, now)) return now
  if (hours.days.length === 0) return null

  // Walk minute by minute to the next opening — at most a week, and the
  // jump below skips straight to the start time of each day.
  const start = toMinutes(hours.start)
  let cursor = new Date(Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS)
  for (let day = 0; day <= 7; day += 1) {
    const { minute } = localClock(cursor)
    const toStart = (start - minute + DAY_MINUTES) % DAY_MINUTES
    const candidate = new Date(cursor.getTime() + toStart * MINUTE_MS)
    if (candidate > now && isWithinBusinessHours(hours, candidate)) {
      return candidate
    }
    cursor = new Date(candidate.getTime() + MINUTE_MS)
  }
  return null
}

const openingFormatter = new Intl.DateTimeFormat('pt-BR', {
  timeZone: WHATSAPP_BUSINESS_HOURS_TIME_ZONE,
  weekday: 'long',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

/** "segunda-feira, 21/10, 08:00" — for the agents. */
export function formatBusinessOpening(date: Date): string {
  return openingFormatter.format(date)
}
