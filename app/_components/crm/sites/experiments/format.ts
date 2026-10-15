import { addDays, localDayOf, startOfLocalDay } from '@/src/lib/sites/analytics'
import type {
  SiteExperimentDTO,
  SiteExperimentGoalDTO,
  SiteExperimentState,
} from '@/types/site-experiment'

/*
 * Copy and formatting of the "Testes A/B" screens. Dates are the site's
 * own (its timezone), never the browser's.
 */

const MONTHS = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
]

/** "15 out" from `2026-10-15`. */
export function formatDay(day: string): string {
  const [, month, date] = day.split('-')
  return `${Number(date)} ${MONTHS[Number(month) - 1] ?? ''}`
}

export const STATE_LABELS: Record<SiteExperimentState, string> = {
  DRAFT: 'Rascunho',
  SCHEDULED: 'Agendado',
  RUNNING: 'No ar',
  PAUSED: 'Pausado',
  ENDED: 'Encerrado',
}

const integer = new Intl.NumberFormat('pt-BR')

export function formatCount(value: number): string {
  return integer.format(value)
}

const percent = new Intl.NumberFormat('pt-BR', {
  style: 'percent',
  maximumFractionDigits: 1,
})
const signedPercent = new Intl.NumberFormat('pt-BR', {
  style: 'percent',
  maximumFractionDigits: 1,
  signDisplay: 'exceptZero',
})

export function formatRate(value: number): string {
  return percent.format(value)
}

export function formatUplift(value: number | null): string {
  return value === null ? '—' : signedPercent.format(value)
}

/** "93%"; "> 99,9%" and "< 0,1%" at the ends (never a false certainty). */
export function formatProbability(value: number | null): string {
  if (value === null) return '—'
  if (value > 0.999) return '> 99,9%'
  if (value < 0.001) return '< 0,1%'
  return percent.format(value)
}

export function goalLabel(
  goal: SiteExperimentGoalDTO,
  names: {
    forms?: Record<string, string>
    pages?: Record<string, string>
  } = {},
): string {
  if (goal.type === 'FORM') {
    return goal.formToken
      ? `Envio do formulário “${names.forms?.[goal.formToken] ?? 'escolhido'}”`
      : 'Envio de qualquer formulário'
  }
  if (goal.type === 'CLICK') {
    return `Clique em “${goal.label ?? 'elemento escolhido'}”`
  }
  return `Chegar à página “${names.pages?.[goal.pageId] ?? 'escolhida'}”`
}

/** "15 out" of an instant in the site's timezone. */
export function formatSiteDay(iso: string, timezone: string): string {
  return formatDay(localDayOf(new Date(iso), timezone))
}

/** Schedule line of a test ("De 20 out a 30 out", "A partir de 20 out"). */
export function scheduleLabel(
  experiment: Pick<SiteExperimentDTO, 'startsAt' | 'endsAt'>,
  timezone: string,
): string | null {
  const start = experiment.startsAt
    ? formatSiteDay(experiment.startsAt, timezone)
    : null
  const end = experiment.endsAt
    ? formatDay(endDayOf(experiment.endsAt, timezone))
    : null
  if (start && end) return `De ${start} a ${end}`
  if (start) return `A partir de ${start}`
  if (end) return `Até ${end}`
  return null
}

/** Start of a schedule from a `YYYY-MM-DD` day in the site's timezone. */
export function startsAtOf(day: string, timezone: string): string | null {
  return day ? startOfLocalDay(day, timezone).toISOString() : null
}

/** End of a schedule: the test runs through the whole chosen day. */
export function endsAtOf(day: string, timezone: string): string | null {
  return day ? startOfLocalDay(addDays(day, 1), timezone).toISOString() : null
}

/** `YYYY-MM-DD` of a schedule start, for a date input. */
export function startDayOf(iso: string | null, timezone: string): string {
  return iso ? localDayOf(new Date(iso), timezone) : ''
}

/** `YYYY-MM-DD` of the last day a schedule runs. */
export function endDayOf(iso: string, timezone: string): string {
  return localDayOf(new Date(new Date(iso).getTime() - 1), timezone)
}
