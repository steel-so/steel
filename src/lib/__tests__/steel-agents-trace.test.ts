import { describe, expect, it } from 'vitest'
import {
  CONTEXT_EXCERPT_LIMIT,
  contextExcerpt,
  diffGuard,
  GUARDRAIL_RULE_LABEL,
  GUARDRAIL_RULES,
  guardrailOutput,
  snapshotGuard,
} from '../steel-agents/trace'

const report = (
  over: Partial<Parameters<typeof diffGuard>[1] & object> = {},
) => ({
  piiCounts: { EMAIL: 0, CNPJ: 0, CPF: 0, CARD: 0, PHONE: 0 },
  injection: {
    detected: false,
    signals: [] as string[],
    sources: [] as string[],
  },
  failovers: [] as { from: string; to: string; reason: string }[],
  ...over,
})

describe('steel agents trace', () => {
  it('should label every rule in pt-BR', () => {
    for (const rule of GUARDRAIL_RULES) {
      expect(GUARDRAIL_RULE_LABEL[rule].length).toBeGreaterThan(3)
    }
  })

  it('should build the output of a guardrail step', () => {
    expect(guardrailOutput('ROUND_LIMIT', 'x', { n: 1 })).toEqual({
      n: 1,
      rule: 'ROUND_LIMIT',
      detail: 'x',
    })
    expect(guardrailOutput('ROUND_LIMIT', 'y').detail).toBe('y')
  })

  it('should snapshot an absent report as empty', () => {
    expect(snapshotGuard(undefined)).toEqual({
      piiCounts: { EMAIL: 0, CNPJ: 0, CPF: 0, CARD: 0, PHONE: 0 },
      injectionSources: 0,
      failovers: 0,
    })
    expect(diffGuard(snapshotGuard(undefined), undefined).events).toEqual([])
  })

  it('should report nothing when nothing changed', () => {
    const r = report()
    expect(diffGuard(snapshotGuard(r), r).events).toEqual([])
  })

  it('should report only what is new since the last look', () => {
    const r = report()
    const first = diffGuard(snapshotGuard(r), {
      ...r,
      piiCounts: { ...r.piiCounts, EMAIL: 1, PHONE: 2 },
      injection: { detected: true, signals: ['s'], sources: ['tool_result'] },
      failovers: [{ from: 'a', to: 'b', reason: 'timeout' }],
    })
    expect(first.events.map((e) => e.rule)).toEqual([
      'PROMPT_INJECTION',
      'PII_MASKED',
      'MODEL_FAILOVER',
    ])
    expect(first.events[1].detail).toBe(
      'Antes de ir ao modelo, foram mascarados: 1 e-mail, 2 telefone.',
    )
    expect(first.events[2].detail).toContain('a falhou (timeout)')

    const again = diffGuard(first.snapshot, {
      ...r,
      piiCounts: { ...r.piiCounts, EMAIL: 3, PHONE: 2 },
      injection: { detected: true, signals: ['s'], sources: ['tool_result'] },
      failovers: [{ from: 'a', to: 'b', reason: 'timeout' }],
    })
    expect(again.events.map((e) => e.rule)).toEqual(['PII_MASKED'])
    expect(again.events[0].counts).toEqual({ EMAIL: 2 })
  })

  it('should keep short contexts whole and cut long ones', () => {
    expect(contextExcerpt('abc')).toEqual({ excerpt: 'abc', truncated: false })
    const long = contextExcerpt('x'.repeat(CONTEXT_EXCERPT_LIMIT + 1))
    expect(long.truncated).toBe(true)
    expect(long.excerpt).toHaveLength(CONTEXT_EXCERPT_LIMIT)
  })
})
