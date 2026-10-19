import { describe, expect, it } from 'vitest'
import {
  averageScore,
  buildJudgePrompt,
  caseVerdict,
  needsJudge,
  normalizeForCheck,
  parseJudgeOutput,
  runTextChecks,
} from '../ai/eval-grading'

describe('eval grading', () => {
  it('normalizes case, accents and spaces', () => {
    expect(normalizeForCheck('  Atenção   PRAZO ')).toBe('atencao prazo')
  })

  it('runs the text checks', () => {
    expect(runTextChecks('O prazo é de 4 horas', ['PRAZO'], ['senha'])).toEqual(
      [],
    )
    expect(runTextChecks('Informe sua senha', ['prazo'], ['Senha'])).toEqual([
      'Deveria conter "prazo"',
      'Não deveria conter "Senha"',
    ])
  })

  it('needs the judge only with expected answer or criteria', () => {
    expect(needsJudge({ expected: null, criteria: null })).toBe(false)
    expect(needsJudge({ expected: 'x', criteria: null })).toBe(true)
    expect(needsJudge({ expected: null, criteria: 'y' })).toBe(true)
  })

  it('builds the judge prompt with only the parts present', () => {
    const full = buildJudgePrompt({
      question: 'Q',
      answer: 'A',
      expected: 'E',
      criteria: 'C',
    })
    expect(full).toContain('<resposta_esperada>\nE')
    expect(full).toContain('<criterios>\nC')
    const bare = buildJudgePrompt({
      question: 'Q',
      answer: 'A',
      expected: null,
      criteria: null,
    })
    expect(bare).not.toContain('resposta_esperada')
    expect(bare).not.toContain('criterios')
  })

  it('parses the judge output', () => {
    expect(parseJudgeOutput('{"score":0.8,"rationale":"ok"}')).toEqual({
      score: 0.8,
      rationale: 'ok',
    })
    expect(parseJudgeOutput('```json\n{"score":3}\n```')).toEqual({
      score: 1,
      rationale: '',
    })
    expect(parseJudgeOutput('{"score":-1,"rationale":"x"}')?.score).toBe(0)
    expect(parseJudgeOutput('not json')).toBeNull()
    expect(parseJudgeOutput('null')).toBeNull()
    expect(parseJudgeOutput('{"score":"a"}')).toBeNull()
  })

  it('decides the verdict of a case', () => {
    expect(
      caseVerdict({ failedChecks: [], judged: false, judgeScore: null }),
    ).toEqual({ passed: true, judgePassed: null })
    expect(
      caseVerdict({ failedChecks: [], judged: true, judgeScore: 0.7 }),
    ).toEqual({ passed: true, judgePassed: true })
    expect(
      caseVerdict({ failedChecks: [], judged: true, judgeScore: 0.5 }),
    ).toEqual({ passed: false, judgePassed: false })
    expect(
      caseVerdict({ failedChecks: [], judged: true, judgeScore: null }),
    ).toEqual({ passed: false, judgePassed: false })
    expect(
      caseVerdict({ failedChecks: ['x'], judged: true, judgeScore: 1 }),
    ).toEqual({ passed: false, judgePassed: true })
  })

  it('averages the present scores', () => {
    expect(averageScore([])).toBeNull()
    expect(averageScore([null])).toBeNull()
    expect(averageScore([0.5, null, 1])).toBe(0.75)
  })
})
