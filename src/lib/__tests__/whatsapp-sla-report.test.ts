import { describe, expect, it } from 'vitest'
import { percentile, summarizeSlaCycles } from '@/src/lib/whatsapp/sla-report'
import type { WhatsAppSlaReportRow } from '@/src/repositories/whatsapp-sla-cycle.repository'

const start = new Date('2026-10-20T12:00:00Z')
const at = (minutes: number) => new Date(start.getTime() + minutes * 60_000)
const now = at(24 * 60)

function row(overrides: Partial<WhatsAppSlaReportRow>): WhatsAppSlaReportRow {
  return {
    teamId: null,
    agentUserId: null,
    startedAt: start,
    firstResponseDueAt: at(15),
    firstResponseAt: null,
    firstResponseSeconds: null,
    resolutionDueAt: null,
    resolvedAt: null,
    firstResponseBreachedAt: null,
    resolutionBreachedAt: null,
    ...overrides,
  }
}

const labels = {
  agentLabels: new Map([
    ['u1', 'Ana'],
    ['u2', 'Bruno'],
  ]),
  teamLabels: new Map([['t1', 'Suporte']]),
}

describe('percentile()', () => {
  it('should be null for an empty list', () => {
    expect(percentile([], 90)).toBeNull()
  })

  it('should use the nearest-rank method', () => {
    const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
    expect(percentile(values, 90)).toBe(90)
    expect(percentile(values, 50)).toBe(50)
    expect(percentile([5], 90)).toBe(5)
    expect(percentile([30, 10, 20], 100)).toBe(30)
    expect(percentile([30, 10, 20], 0)).toBe(10)
  })
})

describe('summarizeSlaCycles()', () => {
  it('should report nothing for an empty period', () => {
    const summary = summarizeSlaCycles({ rows: [], now, ...labels })
    expect(summary.firstResponse).toEqual({
      evaluated: 0,
      withinTarget: 0,
      withinPercent: null,
      averageSeconds: null,
      p90Seconds: null,
    })
    expect(summary.resolution.withinPercent).toBeNull()
    expect(summary.byAgent).toEqual([])
    expect(summary.byTeam).toEqual([])
  })

  it('should count first responses within and after the deadline', () => {
    const summary = summarizeSlaCycles({
      rows: [
        row({ firstResponseAt: at(5), firstResponseSeconds: 300 }),
        row({ firstResponseAt: at(15), firstResponseSeconds: 900 }),
        row({ firstResponseAt: at(40), firstResponseSeconds: 2400 }),
      ],
      now,
      ...labels,
    })
    expect(summary.firstResponse).toMatchObject({
      evaluated: 3,
      withinTarget: 2,
      withinPercent: 66.7,
      averageSeconds: 1200,
      p90Seconds: 2400,
    })
  })

  it('should treat an unanswered cycle past its deadline as a miss', () => {
    const summary = summarizeSlaCycles({
      rows: [row({})],
      now,
      ...labels,
    })
    expect(summary.firstResponse).toMatchObject({
      evaluated: 1,
      withinTarget: 0,
      withinPercent: 0,
      averageSeconds: null,
    })
  })

  it('should leave a still-running first response out', () => {
    const summary = summarizeSlaCycles({
      rows: [row({ firstResponseDueAt: at(24 * 60 + 10) })],
      now,
      ...labels,
    })
    expect(summary.firstResponse.evaluated).toBe(0)
    expect(summary.byAgent).toEqual([])
  })

  it('should leave out a cycle closed before the deadline without an answer', () => {
    const summary = summarizeSlaCycles({
      rows: [row({ resolvedAt: at(5) })],
      now,
      ...labels,
    })
    expect(summary.firstResponse.evaluated).toBe(0)
  })

  it('should count a cycle closed after the deadline without an answer as a miss', () => {
    const summary = summarizeSlaCycles({
      rows: [row({ resolvedAt: at(30) })],
      now,
      ...labels,
    })
    expect(summary.firstResponse).toMatchObject({
      evaluated: 1,
      withinTarget: 0,
    })
  })

  it('should evaluate the resolution only when the policy tracked it', () => {
    const summary = summarizeSlaCycles({
      rows: [
        row({
          firstResponseAt: at(1),
          firstResponseSeconds: 60,
          resolutionDueAt: at(60),
          resolvedAt: at(50),
        }),
        row({
          firstResponseAt: at(1),
          firstResponseSeconds: 60,
          resolutionDueAt: at(60),
          resolvedAt: at(90),
        }),
        row({
          firstResponseAt: at(1),
          firstResponseSeconds: 60,
          resolutionDueAt: at(60),
        }),
        row({
          firstResponseAt: at(1),
          firstResponseSeconds: 60,
          resolutionDueAt: at(24 * 60 + 5),
        }),
        row({ firstResponseAt: at(1), firstResponseSeconds: 60 }),
      ],
      now,
      ...labels,
    })
    expect(summary.resolution).toEqual({
      evaluated: 3,
      withinTarget: 1,
      withinPercent: 33.3,
    })
  })

  it('should break breaches down by agent and team, worst first', () => {
    const summary = summarizeSlaCycles({
      rows: [
        row({
          agentUserId: 'u1',
          teamId: 't1',
          firstResponseAt: at(5),
          firstResponseSeconds: 300,
        }),
        row({ agentUserId: 'u1', teamId: 't1' }),
        row({ agentUserId: 'u2', teamId: 't1' }),
        row({ agentUserId: 'u2', teamId: 't1' }),
        row({ agentUserId: null, teamId: null }),
        row({ agentUserId: 'gone', teamId: 'gone' }),
      ],
      now,
      ...labels,
    })
    expect(
      summary.byAgent.map((entry) => [
        entry.label,
        entry.cycles,
        entry.breaches,
      ]),
    ).toEqual([
      ['Bruno', 2, 2],
      ['Ana', 2, 1],
      ['Removido', 1, 1],
      ['Sem responsável', 1, 1],
    ])
    expect(summary.byTeam[0]).toMatchObject({
      id: 't1',
      label: 'Suporte',
      cycles: 4,
      breaches: 3,
    })
    expect(summary.byTeam.map((entry) => entry.label)).toContain('Sem equipe')
  })
})
