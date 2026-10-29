import { describe, expect, it } from 'vitest'
import { createFakeSdAiClassification } from '@/src/__tests__/factories/nov-s9-ai-vs-technician.factory'
import {
  compareSdAiClassification,
  isSdAiMatch,
  SdAiFieldTally,
  sdAiCalibration,
  sdAiConfidenceBand,
  sdAiPercent,
  sdAiTextOutcome,
  sdAiTextSimilarity,
} from '../servicedesk/ai-comparison'

const NOW = new Date('2026-10-20T12:00:00.000Z')
const HOUR = 3_600_000

const full = createFakeSdAiClassification({
  category: { id: 'c1', name: 'Rede' },
  subcategory: { id: 's1', name: 'VPN' },
  service: { id: 'v1', name: 'Acesso remoto' },
  impact: { id: 'i1', name: 'Alto' },
  urgency: { id: 'u1', name: 'Alta' },
  priority: { id: 'p1', name: 'P1' },
  department: { id: 'd1', name: 'Suporte' },
  tags: ['VPN', 'acesso'],
})

describe('compareSdAiClassification', () => {
  it('separates what the AI applied from what the human already had', () => {
    const result = compareSdAiClassification(full, ['categoryId', 'tags'], {
      refs: {
        category: { id: 'c1', name: 'Rede' },
        subcategory: { id: 'other', name: 'Wi-Fi' },
        service: { id: 'v1', name: 'Acesso remoto' },
        impact: { id: 'zzz', name: 'Baixo' },
        urgency: { id: 'u1', name: 'Alta' },
        priority: { id: 'p1', name: 'P1' },
        department: { id: 'd1', name: 'Suporte' },
      },
      tags: ['acesso', 'vpn'],
    })
    const by = Object.fromEntries(result.map((r) => [r.field, r.outcome]))
    expect(by).toEqual({
      category: 'APPLIED_KEPT',
      subcategory: 'DISAGREED',
      service: 'AGREED',
      impact: 'DISAGREED',
      urgency: 'AGREED',
      priority: 'AGREED',
      department: 'AGREED',
      tags: 'APPLIED_KEPT',
    })
  })

  it('flags a field the AI filled and the technician changed', () => {
    const [category, tags] = compareSdAiClassification(
      createFakeSdAiClassification({ tags: ['vpn'] }),
      ['categoryId', 'tags'],
      { refs: { category: { id: 'x', name: 'Outro' } }, tags: [] },
    )
    expect(category).toMatchObject({
      field: 'category',
      outcome: 'APPLIED_CHANGED',
      suggested: 'Rede',
      final: 'Outro',
      appliedByAi: true,
    })
    expect(tags).toMatchObject({
      field: 'tags',
      outcome: 'APPLIED_CHANGED',
      final: '—',
    })
  })

  it('shows a dash when the ticket has no value and skips fields the AI left empty', () => {
    const result = compareSdAiClassification(
      createFakeSdAiClassification(),
      [],
      { refs: {}, tags: [] },
    )
    expect(result).toEqual([
      {
        field: 'category',
        outcome: 'DISAGREED',
        suggested: 'Rede',
        final: '—',
        appliedByAi: false,
      },
    ])
  })

  it('ignores the priority when the AI filled impact or urgency (matrix recalculates it)', () => {
    const state = { refs: { priority: { id: 'other', name: 'P3' } }, tags: [] }
    const withImpact = compareSdAiClassification(full, ['impactId'], state)
    expect(withImpact.some((r) => r.field === 'priority')).toBe(false)
    const withUrgency = compareSdAiClassification(full, ['urgencyId'], state)
    expect(withUrgency.some((r) => r.field === 'priority')).toBe(false)
    const without = compareSdAiClassification(full, [], state)
    expect(without.some((r) => r.field === 'priority')).toBe(true)
  })

  it('treats tag lists as equal regardless of order, case and spaces', () => {
    const [tags] = compareSdAiClassification(
      createFakeSdAiClassification({ category: null, tags: [' VPN', 'Rede'] }),
      [],
      { refs: {}, tags: ['rede', 'vpn'] },
    )
    expect(tags?.outcome).toBe('AGREED')
  })
})

describe('isSdAiMatch / sdAiPercent', () => {
  it('counts kept and agreed as matches', () => {
    expect(isSdAiMatch('APPLIED_KEPT')).toBe(true)
    expect(isSdAiMatch('AGREED')).toBe(true)
    expect(isSdAiMatch('APPLIED_CHANGED')).toBe(false)
    expect(isSdAiMatch('DISAGREED')).toBe(false)
  })

  it('rounds and returns null without a sample', () => {
    expect(sdAiPercent(1, 3)).toBe(33)
    expect(sdAiPercent(0, 0)).toBeNull()
  })
})

describe('SdAiFieldTally', () => {
  it('aggregates per field in catalog order', () => {
    const tally = new SdAiFieldTally()
    tally.add({
      field: 'category',
      outcome: 'APPLIED_KEPT',
      suggested: 'a',
      final: 'a',
      appliedByAi: true,
    })
    tally.add({
      field: 'category',
      outcome: 'APPLIED_CHANGED',
      suggested: 'a',
      final: 'b',
      appliedByAi: true,
    })
    tally.add({
      field: 'tags',
      outcome: 'AGREED',
      suggested: 'x',
      final: 'x',
      appliedByAi: false,
    })
    expect(tally.compared).toBe(3)
    expect(tally.matched).toBe(2)
    expect(tally.corrected).toBe(1)
    const stats = tally.toStats()
    expect(stats).toHaveLength(8)
    expect(stats[0]).toMatchObject({
      field: 'category',
      label: 'Categoria',
      compared: 2,
      matched: 1,
      corrected: 1,
      accuracy: 50,
    })
    expect(stats.find((s) => s.field === 'urgency')).toMatchObject({
      compared: 0,
      accuracy: null,
    })
  })
})

describe('calibration', () => {
  it('maps confidence to bands at the edges', () => {
    expect(sdAiConfidenceBand(0.49)).toBe('LOW')
    expect(sdAiConfidenceBand(0.5)).toBe('MEDIUM')
    expect(sdAiConfidenceBand(0.79)).toBe('MEDIUM')
    expect(sdAiConfidenceBand(0.8)).toBe('HIGH')
  })

  it('weights accuracy by compared fields and ignores empty samples', () => {
    const result = sdAiCalibration([
      { confidence: 0.9, compared: 4, matched: 4 },
      { confidence: 0.85, compared: 4, matched: 2 },
      { confidence: 0.2, compared: 2, matched: 0 },
      { confidence: 0.6, compared: 0, matched: 0 },
    ])
    expect(result).toEqual([
      {
        band: 'LOW',
        label: 'Confiança baixa (< 50%)',
        tickets: 1,
        accuracy: 0,
      },
      {
        band: 'MEDIUM',
        label: 'Confiança média (50–79%)',
        tickets: 0,
        accuracy: null,
      },
      {
        band: 'HIGH',
        label: 'Confiança alta (≥ 80%)',
        tickets: 2,
        accuracy: 75,
      },
    ])
  })
})

describe('sdAiTextSimilarity', () => {
  it('is 1 for the same words, ignoring accents, case and HTML', () => {
    expect(
      sdAiTextSimilarity(
        'Reinicie o serviço de conexão',
        '<p>REINICIE o servico de conexao</p>',
      ),
    ).toBe(1)
  })

  it('is partial for edited text and 0 for unrelated or empty text', () => {
    const edited = sdAiTextSimilarity(
      'Reinicie o cliente VPN e tente novamente',
      'Reinicie o cliente VPN, limpe o cache e confirme o acesso',
    )
    expect(edited).toBeGreaterThan(0.3)
    expect(edited).toBeLessThan(0.8)
    expect(sdAiTextSimilarity('abc def ghi', 'xyz uvw rst')).toBe(0)
    expect(sdAiTextSimilarity('', 'qualquer coisa')).toBe(0)
    expect(sdAiTextSimilarity('de o a', 'de o a')).toBe(0)
  })
})

describe('sdAiTextOutcome', () => {
  const recent = new Date(NOW.getTime() - HOUR)
  const old = new Date(NOW.getTime() - 48 * HOUR)

  it('classifies by similarity thresholds', () => {
    expect(sdAiTextOutcome(0.8, old, NOW)).toBe('ADOPTED')
    expect(sdAiTextOutcome(0.79, old, NOW)).toBe('EDITED')
    expect(sdAiTextOutcome(0.35, old, NOW)).toBe('EDITED')
    expect(sdAiTextOutcome(0.34, old, NOW)).toBe('NOT_USED')
  })

  it('keeps a recent suggestion pending until the agent writes something', () => {
    expect(sdAiTextOutcome(null, recent, NOW)).toBe('PENDING')
    expect(sdAiTextOutcome(null, old, NOW)).toBe('NOT_USED')
  })
})
