import { describe, expect, it } from 'vitest'
import { createFakeAiInsightDraft } from '@/src/__tests__/factories/ai-insight.factory'
import {
  agentEventFor,
  type ExistingInsightRow,
  insightRowKey,
  newEpisodes,
  planInsightReconcile,
} from '@/src/lib/ai/proactive/reconcile'

function row(overrides: Partial<ExistingInsightRow>): ExistingInsightRow {
  return {
    id: 'r1',
    userId: 'u1',
    dedupeKey: 'crm-stale:owner:u1',
    module: 'CRM',
    status: 'ACTIVE',
    ...overrides,
  }
}

describe('planInsightReconcile', () => {
  it('creates, refreshes, reopens and resolves by episode', () => {
    const fresh = createFakeAiInsightDraft({ dedupeKey: 'crm-stale:all' })
    const same = createFakeAiInsightDraft()
    const back = createFakeAiInsightDraft({ dedupeKey: 'crm-stage:s1' })

    const plan = planInsightReconcile(
      [
        row({ id: 'active', dedupeKey: 'crm-stale:owner:u1' }),
        row({ id: 'resolved', dedupeKey: 'crm-stage:s1', status: 'RESOLVED' }),
        row({ id: 'gone', dedupeKey: 'crm-forecast:2026-09' }),
        row({ id: 'old', dedupeKey: 'crm-stage:s0', status: 'RESOLVED' }),
      ],
      [fresh, same, back],
      ['CRM'],
    )

    expect(plan.create).toEqual([fresh])
    expect(plan.refresh).toEqual([{ id: 'active', draft: same }])
    expect(plan.reopen).toEqual([{ id: 'resolved', draft: back }])
    expect(plan.resolveIds).toEqual(['gone'])
  })

  it('leaves the modules that were not evaluated untouched', () => {
    const plan = planInsightReconcile(
      [
        row({
          id: 'sd',
          module: 'SERVICE_DESK',
          dedupeKey: 'sd-breach:dept:d1',
        }),
      ],
      [
        createFakeAiInsightDraft({
          module: 'SERVICE_DESK',
          dedupeKey: 'sd-breach:dept:d2',
        }),
      ],
      ['CRM'],
    )
    expect(plan).toEqual({
      create: [],
      refresh: [],
      reopen: [],
      resolveIds: [],
    })
  })

  it('keeps the first draft when a rule repeats a key for a user', () => {
    const first = createFakeAiInsightDraft({ title: 'primeiro' })
    const second = createFakeAiInsightDraft({ title: 'segundo' })
    const plan = planInsightReconcile([], [first, second], ['CRM'])
    expect(plan.create).toEqual([first])
  })

  it('keys rows by user and dedupe key', () => {
    expect(insightRowKey('u1', 'a')).not.toBe(insightRowKey('u2', 'a'))
    const plan = planInsightReconcile(
      [row({ userId: 'u2', dedupeKey: 'crm-stale:all' })],
      [createFakeAiInsightDraft({ userId: 'u1', dedupeKey: 'crm-stale:all' })],
      ['CRM'],
    )
    expect(plan.create).toHaveLength(1)
    expect(plan.resolveIds).toEqual(['r1'])
  })
})

describe('newEpisodes and agent events', () => {
  it('returns each new condition once, across recipients', () => {
    const plan = planInsightReconcile(
      [
        row({
          id: 'x',
          userId: 'u3',
          dedupeKey: 'crm-stale:all',
          status: 'RESOLVED',
        }),
      ],
      [
        createFakeAiInsightDraft({ userId: 'u1', dedupeKey: 'crm-stale:all' }),
        createFakeAiInsightDraft({ userId: 'u2', dedupeKey: 'crm-stale:all' }),
        createFakeAiInsightDraft({ userId: 'u3', dedupeKey: 'crm-stale:all' }),
      ],
      ['CRM'],
    )
    expect(newEpisodes(plan).map((d) => [d.userId, d.dedupeKey])).toEqual([
      ['u1', 'crm-stale:all'],
    ])
  })

  it('fires events only for conditions that read the same for everyone', () => {
    const event = (dedupeKey: string) =>
      agentEventFor(createFakeAiInsightDraft({ dedupeKey }))
    expect(event('sd-breach:dept:d1')).toBe('sd.insight.detected')
    expect(event('crm-stale:all')).toBe('crm.insight.detected')
    expect(event('crm-stage:s1')).toBe('crm.insight.detected')
    expect(event('crm-forecast:2026-10')).toBe('crm.insight.detected')
    expect(event('zap-sentiment:c1')).toBe('zap.insight.detected')
    expect(event('sd-breach:assignee:u1')).toBeNull()
    expect(event('crm-stale:owner:u1')).toBeNull()
    expect(event('zap-waiting:queue')).toBeNull()
  })
})
