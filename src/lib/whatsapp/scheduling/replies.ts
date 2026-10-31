export type AppointmentReply = 'CONFIRM' | 'CANCEL'

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .replace(/^[\s\p{P}\p{S}]+|[\s\p{P}\p{S}]+$/gu, '')
}

const CONFIRM = new Set(['CONFIRMAR', 'CONFIRMO', 'CONFIRMADO', 'SIM', '1'])
const CANCEL = new Set(['CANCELAR', 'CANCELA', 'CANCELADO', 'NAO', '2'])

/**
 * Reads the answer to a confirmation / reminder. Only the whole message
 * counts ("não posso ir amanhã" is a conversation, not a cancellation).
 */
export function parseAppointmentReply(
  text: string | null | undefined,
): AppointmentReply | null {
  if (!text) return null
  const value = normalize(text)
  if (CONFIRM.has(value)) return 'CONFIRM'
  if (CANCEL.has(value)) return 'CANCEL'
  return null
}

/**
 * The reminder due now, if any. Only the tightest due offset is sent (a late
 * tick must not send the 24 h and the 2 h reminder together); every offset
 * already reached is marked as sent so the wider ones never fire afterwards.
 */
export function dueReminder(input: {
  startsAt: Date
  now: Date
  offsets: number[]
  sent: number[]
}): { send: number; markSent: number[] } | null {
  const untilStart = (input.startsAt.getTime() - input.now.getTime()) / 60_000
  if (untilStart <= 0) return null
  const due = input.offsets
    .filter((offset) => untilStart <= offset && !input.sent.includes(offset))
    .sort((a, b) => a - b)
  if (due.length === 0) return null
  return { send: due[0], markSent: due }
}
