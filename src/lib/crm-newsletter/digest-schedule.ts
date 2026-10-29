import { Cron } from 'croner'

/**
 * When the newsletter digest runs (newsletter2 nl2-digest-ai): weekly on a
 * weekday or monthly on a day (1–28, so every month has it), at a whole
 * hour in America/Sao_Paulo. `croner` is the engine the worker uses for
 * the other schedules.
 */

export const DIGEST_TIMEZONE = 'America/Sao_Paulo'
/** Placeholder of the digest subject replaced by the run date. */
export const DIGEST_DATE_TOKEN = '{data}'

export type DigestCadenceInput = {
  cadence: 'WEEKLY' | 'MONTHLY'
  weekday: number | null
  monthDay: number | null
  hour: number
}

/** Five-field cron of a cadence (`null` when a needed field is missing). */
export function digestCron(input: DigestCadenceInput): string | null {
  if (input.hour < 0 || input.hour > 23) return null
  if (input.cadence === 'WEEKLY') {
    if (input.weekday === null || input.weekday < 0 || input.weekday > 6) {
      return null
    }
    return `0 ${input.hour} * * ${input.weekday}`
  }
  if (input.monthDay === null || input.monthDay < 1 || input.monthDay > 28) {
    return null
  }
  return `0 ${input.hour} ${input.monthDay} * *`
}

/** Next run strictly after `after`, or `null` for an incomplete cadence. */
export function nextDigestRun(
  input: DigestCadenceInput,
  after: Date,
): Date | null {
  const cron = digestCron(input)
  if (!cron) return null
  return new Cron(cron, { timezone: DIGEST_TIMEZONE, paused: true }).nextRun(
    after,
  )
}

/** Days a first digest looks back when no digest ran yet. */
export function firstDigestLookbackDays(cadence: 'WEEKLY' | 'MONTHLY') {
  return cadence === 'WEEKLY' ? 7 : 31
}

/** "28 de outubro de 2026" in São Paulo. */
export function digestDateLabel(now: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: DIGEST_TIMEZONE,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(now)
}

/** The digest subject with `{data}` replaced (max 200 characters). */
export function digestSubject(template: string, now: Date): string {
  return template
    .split(DIGEST_DATE_TOKEN)
    .join(digestDateLabel(now))
    .trim()
    .slice(0, 200)
}
