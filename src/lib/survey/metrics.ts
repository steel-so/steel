import type { SurveyKind } from './scale'

export interface SurveyScoreRow {
  score: number
}

export interface SurveyMetrics {
  answered: number
  average: number | null
  /** NPS only: % promoters − % detractors, from −100 to 100. */
  nps: number | null
  promoters: number
  passives: number
  detractors: number
  /** CSAT only: % of answers 4–5. */
  csat: number | null
  /** CES only: same as the average (1–7, higher is easier). */
  ces: number | null
}

const round = (value: number, digits = 1): number => {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/**
 * Metrics of a set of answers of one kind. Rows of another kind must not be
 * mixed in: the scales differ.
 */
export function summarizeScores(
  kind: SurveyKind,
  rows: SurveyScoreRow[],
): SurveyMetrics {
  const answered = rows.length
  const empty: SurveyMetrics = {
    answered: 0,
    average: null,
    nps: null,
    promoters: 0,
    passives: 0,
    detractors: 0,
    csat: null,
    ces: null,
  }
  if (answered === 0) return empty

  const sum = rows.reduce((acc, row) => acc + row.score, 0)
  const average = round(sum / answered, 2)
  const result: SurveyMetrics = { ...empty, answered, average }

  if (kind === 'NPS') {
    result.promoters = rows.filter((r) => r.score >= 9).length
    result.detractors = rows.filter((r) => r.score <= 6).length
    result.passives = answered - result.promoters - result.detractors
    result.nps = round(
      ((result.promoters - result.detractors) / answered) * 100,
    )
  } else if (kind === 'CSAT') {
    result.csat = round(
      (rows.filter((r) => r.score >= 4).length / answered) * 100,
    )
  } else {
    result.ces = average
  }
  return result
}

export function responseRate(sent: number, answered: number): number | null {
  if (sent <= 0) return null
  return round((answered / sent) * 100)
}
