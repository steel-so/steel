const SAO_PAULO = 'America/Sao_Paulo'

const PARTS_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: SAO_PAULO,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

/** Offset (ms) of São Paulo wall-clock time from UTC at `instant`. */
function saoPauloOffsetAt(instant: number): number {
  const parts = Object.fromEntries(
    PARTS_FORMAT.formatToParts(new Date(instant)).map((p) => [p.type, p.value]),
  )
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  )
  return asUtc - Math.floor(instant / 1000) * 1000
}

/**
 * UTC instant of the São Paulo midnight that starts the calendar day of
 * `now`. Used by the "inserted today" contact filter: between 21:00 and 23:59
 * in São Paulo UTC has already turned the day, and the filter must still
 * follow the Brazilian calendar.
 */
export function startOfSaoPauloDay(now = new Date()): Date {
  const local = now.getTime() + saoPauloOffsetAt(now.getTime())
  const localMidnight = Math.floor(local / 86_400_000) * 86_400_000
  const first = localMidnight - saoPauloOffsetAt(localMidnight)
  // A DST change between the guess and the result moves the offset.
  return new Date(localMidnight - saoPauloOffsetAt(first))
}

const DISPLAY_FORMAT = new Intl.DateTimeFormat('pt-BR', {
  timeZone: SAO_PAULO,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/** `dd/MM/yyyy HH:mm` of a contact's insertion, in São Paulo time. */
export function formatContactCreatedAt(iso: string): string {
  const parts = Object.fromEntries(
    DISPLAY_FORMAT.formatToParts(new Date(iso)).map((p) => [p.type, p.value]),
  )
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`
}
