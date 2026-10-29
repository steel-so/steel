import { describe, expect, it } from 'vitest'
import { responseRate, summarizeScores } from '../survey/metrics'
import {
  buildSurveyPayload,
  isScoreInScale,
  parseSurveyPayload,
  parseTypedScore,
  SURVEY_BUTTONS,
  surveyEmailQuestion,
  surveyQuestion,
} from '../survey/scale'

describe('survey scale', () => {
  it('checks the scale of each kind', () => {
    expect(isScoreInScale('NPS', 0)).toBe(true)
    expect(isScoreInScale('NPS', 10)).toBe(true)
    expect(isScoreInScale('NPS', 11)).toBe(false)
    expect(isScoreInScale('CSAT', 0)).toBe(false)
    expect(isScoreInScale('CSAT', 5)).toBe(true)
    expect(isScoreInScale('CES', 7)).toBe(true)
    expect(isScoreInScale('CES', 2.5)).toBe(false)
  })

  it('keeps every button inside the scale and the 20 character limit', () => {
    for (const kind of ['CSAT', 'CES'] as const) {
      expect(SURVEY_BUTTONS[kind]).toHaveLength(3)
      for (const b of SURVEY_BUTTONS[kind]) {
        expect(isScoreInScale(kind, b.score)).toBe(true)
        expect(b.label.length).toBeLessThanOrEqual(20)
      }
    }
    expect(SURVEY_BUTTONS.NPS).toHaveLength(0)
  })

  it('round-trips the button payload and rejects foreign ones', () => {
    const payload = buildSurveyPayload('abc', 4)
    expect(payload).toBe('stl:s:abc:4')
    expect(parseSurveyPayload(payload)).toEqual({ surveyId: 'abc', score: 4 })
    expect(parseSurveyPayload('stl:q:abc:b1')).toBeNull()
    expect(parseSurveyPayload('stl:s:abc:x')).toBeNull()
    expect(parseSurveyPayload('stl:s::4')).toBeNull()
    expect(parseSurveyPayload('other:s:abc:4')).toBeNull()
    expect(parseSurveyPayload('stl:s:abc')).toBeNull()
    expect(parseSurveyPayload(null)).toBeNull()
    expect(parseSurveyPayload(`stl:s:${'a'.repeat(300)}:4`)).toBeNull()
  })

  it('parses only a bare number as a typed score', () => {
    expect(parseTypedScore(' 9 ')).toBe(9)
    expect(parseTypedScore('10')).toBe(10)
    expect(parseTypedScore('nota 8')).toBeNull()
    expect(parseTypedScore('123')).toBeNull()
    expect(parseTypedScore('')).toBeNull()
    expect(parseTypedScore(undefined)).toBeNull()
  })

  it('uses the custom question when set, else the default', () => {
    expect(surveyQuestion('CSAT', '  Gostou? ')).toBe('Gostou?')
    expect(surveyQuestion('NPS', null)).toContain('0 a 10')
    expect(surveyEmailQuestion('CES', '')).toContain('1 (muito difícil)')
    expect(surveyEmailQuestion('CES', 'Fácil?')).toBe('Fácil?')
  })
})

describe('survey metrics', () => {
  it('returns empty metrics without answers', () => {
    const m = summarizeScores('NPS', [])
    expect(m.answered).toBe(0)
    expect(m.average).toBeNull()
    expect(m.nps).toBeNull()
  })

  it('computes NPS as promoters minus detractors', () => {
    const rows = [10, 9, 8, 7, 6, 0].map((score) => ({ score }))
    const m = summarizeScores('NPS', rows)
    expect(m.promoters).toBe(2)
    expect(m.passives).toBe(2)
    expect(m.detractors).toBe(2)
    expect(m.nps).toBe(0)
    expect(m.average).toBe(6.67)
  })

  it('computes CSAT as the share of 4 and 5', () => {
    const m = summarizeScores(
      'CSAT',
      [5, 4, 3, 1].map((score) => ({ score })),
    )
    expect(m.csat).toBe(50)
    expect(m.average).toBe(3.25)
  })

  it('computes CES as the average', () => {
    const m = summarizeScores(
      'CES',
      [7, 5].map((score) => ({ score })),
    )
    expect(m.ces).toBe(6)
  })

  it('computes the response rate', () => {
    expect(responseRate(0, 0)).toBeNull()
    expect(responseRate(4, 1)).toBe(25)
  })
})
