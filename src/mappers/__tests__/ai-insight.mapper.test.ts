import { describe, expect, it } from 'vitest'
import { createFakeAiInsight } from '@/src/__tests__/factories/ai-insight.factory'
import {
  aiInsightStateOf,
  toAiDigestSettingsDTO,
  toAiInsightDTO,
  toAiInsightFacts,
} from '../ai-insight.mapper'

const NOW = new Date('2026-10-18T12:00:00.000Z')
const HOUR = 3_600_000

describe('aiInsightStateOf', () => {
  it('is active, snoozed until the time, and dismissed over a snooze', () => {
    expect(
      aiInsightStateOf({ dismissedAt: null, snoozedUntil: null }, NOW),
    ).toBe('active')
    expect(
      aiInsightStateOf(
        { dismissedAt: null, snoozedUntil: new Date(NOW.getTime() + HOUR) },
        NOW,
      ),
    ).toBe('snoozed')
    expect(
      aiInsightStateOf(
        { dismissedAt: null, snoozedUntil: new Date(NOW.getTime() - HOUR) },
        NOW,
      ),
    ).toBe('active')
    expect(
      aiInsightStateOf(
        { dismissedAt: NOW, snoozedUntil: new Date(NOW.getTime() + HOUR) },
        NOW,
      ),
    ).toBe('dismissed')
  })
})

describe('toAiInsightFacts', () => {
  it('keeps only well-formed string pairs', () => {
    expect(
      toAiInsightFacts([
        { label: 'Chamados', value: '3' },
        { label: 'Número', value: 3 },
        null,
        'texto',
        { value: '1' },
      ]),
    ).toEqual([{ label: 'Chamados', value: '3' }])
    expect(toAiInsightFacts({ label: 'x' })).toEqual([])
  })
})

describe('toAiInsightDTO', () => {
  it('maps a row with its state and ISO dates', () => {
    const row = createFakeAiInsight({
      id: 'i1',
      snoozedUntil: new Date(NOW.getTime() + 2 * HOUR),
    })
    expect(toAiInsightDTO(row, NOW)).toEqual({
      id: 'i1',
      kind: 'CRM_STALE_OPPORTUNITIES',
      module: 'CRM',
      severity: 'INFO',
      title: row.title,
      body: row.body,
      facts: [{ label: 'Oportunidades', value: '2' }],
      href: '/acme/crm/opportunities',
      prompt: 'Liste minhas oportunidades paradas.',
      state: 'snoozed',
      snoozedUntil: '2026-10-18T14:00:00.000Z',
      firstSeenAt: '2026-10-18T12:00:00.000Z',
      lastSeenAt: '2026-10-18T12:00:00.000Z',
    })
  })

  it('hides an expired snooze', () => {
    const row = createFakeAiInsight({
      snoozedUntil: new Date(NOW.getTime() - HOUR),
    })
    expect(toAiInsightDTO(row, NOW)).toMatchObject({
      state: 'active',
      snoozedUntil: null,
    })
  })
})

describe('toAiDigestSettingsDTO', () => {
  it('is opt-out: no row means both channels on', () => {
    expect(toAiDigestSettingsDTO(null, true)).toEqual({
      inApp: true,
      email: true,
      workspaceEnabled: true,
    })
    expect(toAiDigestSettingsDTO({ inApp: false, email: true }, false)).toEqual(
      { inApp: false, email: true, workspaceEnabled: false },
    )
  })
})
