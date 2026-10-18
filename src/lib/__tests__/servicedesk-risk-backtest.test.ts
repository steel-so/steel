import { describe, expect, it } from 'vitest'
import {
  formatSdRiskBacktestReport,
  type SdRiskBacktestSample,
  type SdRiskBacktestTicket,
  sdMedian,
  sdRiskBacktestInstants,
  sdRiskBacktestMetrics,
  sdRiskBacktestOutcome,
  sdRiskBacktestSamples,
  sdRiskSnapshotInput,
  sdRiskSnapshotStats,
} from '@/src/lib/servicedesk/risk-backtest'

/** Backtest do risco (ADR 0016): desfecho, reconstrução e métricas. */

const T0 = new Date('2026-09-01T12:00:00.000Z')
const HOUR = 60 * 60 * 1000
const h = (n: number) => new Date(T0.getTime() + n * HOUR)

function ticket(
  overrides: Partial<SdRiskBacktestTicket> = {},
): SdRiskBacktestTicket {
  return {
    id: 't1',
    createdAt: T0,
    firstResponseDueAt: null,
    resolutionDueAt: h(10),
    firstRespondedAt: h(1),
    resolvedAt: h(8),
    closedAt: h(9),
    firstResponseBreached: false,
    resolutionBreached: false,
    assigneeId: 'u1',
    assignedAt: null,
    departmentId: null,
    customerId: null,
    companyId: null,
    serviceId: null,
    priority: null,
    severity: null,
    teamActivityAt: [],
    reopenedAt: [],
    calendar: null,
    ...overrides,
  }
}

function sample(
  overrides: Partial<SdRiskBacktestSample> = {},
): SdRiskBacktestSample {
  return {
    ticketId: 't1',
    at: h(1),
    level: 'LOW',
    score: 10,
    breached: false,
    breachAt: null,
    ...overrides,
  }
}

describe('sdRiskBacktestOutcome', () => {
  it('should have no outcome without any deadline or without an end', () => {
    expect(sdRiskBacktestOutcome(ticket({ resolutionDueAt: null }))).toBeNull()
    expect(
      sdRiskBacktestOutcome(ticket({ resolvedAt: null, closedAt: null })),
    ).toBeNull()
  })

  it('should call a ticket solved in time met', () => {
    expect(sdRiskBacktestOutcome(ticket())).toEqual({
      breached: false,
      breachAt: null,
      endAt: h(8),
    })
  })

  it('should fall back to the closing date when it was never resolved', () => {
    const outcome = sdRiskBacktestOutcome(
      ticket({ resolvedAt: null, closedAt: h(12) }),
    )

    expect(outcome).toEqual({ breached: true, breachAt: h(10), endAt: h(12) })
  })

  it('should trust the breach flag written by the worker', () => {
    const outcome = sdRiskBacktestOutcome(ticket({ resolutionBreached: true }))

    expect(outcome?.breached).toBe(true)
    expect(outcome?.breachAt).toEqual(h(10))
  })

  it('should take the earliest deadline that broke', () => {
    // 1ª resposta às 3 h (prazo 2 h) e resolução às 12 h (prazo 10 h).
    const outcome = sdRiskBacktestOutcome(
      ticket({
        firstResponseDueAt: h(2),
        firstRespondedAt: h(3),
        resolvedAt: h(12),
      }),
    )

    expect(outcome?.breachAt).toEqual(h(2))
  })

  it('should count a first response never given as late past its deadline', () => {
    const outcome = sdRiskBacktestOutcome(
      ticket({
        firstResponseDueAt: h(2),
        firstRespondedAt: null,
        resolutionDueAt: null,
      }),
    )

    expect(outcome).toEqual({ breached: true, breachAt: h(2), endAt: h(8) })
  })

  it('should honour the first-response flag', () => {
    const outcome = sdRiskBacktestOutcome(
      ticket({
        firstResponseDueAt: h(2),
        firstResponseBreached: true,
        resolutionDueAt: null,
      }),
    )

    expect(outcome?.breachAt).toEqual(h(2))
  })
})

describe('sdRiskBacktestInstants', () => {
  it('should spread the snapshots before the breach', () => {
    const at = sdRiskBacktestInstants(ticket(), {
      breached: true,
      breachAt: h(8),
      endAt: h(12),
    })

    expect(at).toEqual([h(2), h(4), h(6)])
  })

  it('should spread them before the end when nothing broke', () => {
    const at = sdRiskBacktestInstants(
      ticket(),
      { breached: false, breachAt: null, endAt: h(4) },
      [0.5],
    )

    expect(at).toEqual([h(2)])
  })

  it('should skip a ticket that ended in under a minute', () => {
    expect(
      sdRiskBacktestInstants(ticket(), {
        breached: false,
        breachAt: null,
        endAt: new Date(T0.getTime() + 30_000),
      }),
    ).toEqual([])
  })
})

describe('sdRiskSnapshotInput', () => {
  const t = ticket({
    assignedAt: h(3),
    teamActivityAt: [h(5), h(1), h(2)],
    reopenedAt: [h(4), h(6)],
  })

  it('should show only what had happened by the instant', () => {
    const input = sdRiskSnapshotInput(t, h(2))

    expect(input.firstRespondedAt).toEqual(h(1))
    expect(input.assigneeId).toBeNull()
    expect(input.lastTeamActivityAt).toEqual(h(2))
    expect(input.reopenCount).toBe(0)
    expect(input.resolvedAt).toBeNull()
    expect(input.firstResponseBreached).toBe(false)
    expect(input.phase.pausesSla).toBe(false)
  })

  it('should move forward with the instant', () => {
    const input = sdRiskSnapshotInput(t, h(5))

    expect(input.assigneeId).toBe('u1')
    expect(input.lastTeamActivityAt).toEqual(h(5))
    expect(input.reopenCount).toBe(1)
  })

  it('should hide a later first response and a missing team', () => {
    const input = sdRiskSnapshotInput(ticket(), new Date(T0.getTime() + 60_000))

    expect(input.firstRespondedAt).toBeNull()
    expect(input.lastTeamActivityAt).toBeNull()
    // Sem registro de atribuição: o responsável conta desde a abertura.
    expect(input.assigneeId).toBe('u1')
  })

  it('should never invent an owner for an unassigned ticket', () => {
    expect(
      sdRiskSnapshotInput(ticket({ assigneeId: null }), h(5)).assigneeId,
    ).toBeNull()
  })
})

describe('sdRiskSnapshotStats', () => {
  const resolved = [
    {
      ticket: ticket({
        id: 'a',
        departmentId: 'd1',
        assigneeId: 'u1',
        customerId: 'c1',
        serviceId: 's1',
      }),
      outcome: { breached: true, breachAt: h(2), endAt: h(6) },
    },
    {
      ticket: ticket({
        id: 'b',
        departmentId: 'd1',
        assigneeId: null,
        companyId: 'co1',
        createdAt: h(3),
      }),
      outcome: { breached: true, breachAt: h(5), endAt: h(8) },
    },
    {
      ticket: ticket({ id: 'c', departmentId: null, assigneeId: 'u2' }),
      outcome: { breached: false, breachAt: null, endAt: h(1) },
    },
  ]

  it('should count what was open and what had broken at the instant', () => {
    const stats = sdRiskSnapshotStats(resolved, h(4), {
      priority: 4,
      severity: 3,
    })

    expect(stats.maxPriorityLevel).toBe(4)
    expect(stats.maxSeverityLevel).toBe(3)
    expect(stats.openByDepartment).toEqual({ d1: 2 })
    expect(stats.openByAssignee).toEqual({ u1: 1 })
    expect([...stats.breachedCustomerIds]).toEqual(['c1'])
    expect([...stats.breachedServiceIds]).toEqual(['s1'])
  })

  it('should read the company when there is no customer', () => {
    const stats = sdRiskSnapshotStats(resolved, h(7), {
      priority: 0,
      severity: 0,
    })

    expect(stats.breachedCustomerIds.has('co1')).toBe(true)
    expect(stats.openByDepartment).toEqual({ d1: 1 })
  })
})

describe('sdRiskBacktestSamples', () => {
  it('should replay every snapshot of the tickets with a known outcome', () => {
    const { samples, tickets } = sdRiskBacktestSamples(
      [
        // Violado: sem responsável, prioridade máxima, prazo estourado.
        ticket({
          id: 'late',
          assigneeId: null,
          priority: { name: 'P1', level: 4 },
          resolutionDueAt: h(4),
          resolvedAt: h(20),
          closedAt: h(20),
        }),
        ticket({ id: 'ok' }),
        // Sem desfecho conhecido: fora.
        ticket({ id: 'none', resolutionDueAt: null }),
      ],
      { scales: { priority: 4, severity: 0 } },
    )

    expect(tickets).toBe(2)
    expect(samples).toHaveLength(6)
    const late = samples.filter((s) => s.ticketId === 'late')
    expect(
      late.every((s) => s.breached && s.breachAt?.getTime() === h(4).getTime()),
    ).toBe(true)
    // A nota sobe conforme o prazo é consumido.
    expect(late[2].score).toBeGreaterThan(late[0].score)
    expect(
      samples.filter((s) => s.ticketId === 'ok').every((s) => !s.breached),
    ).toBe(true)
  })

  it('should accept custom fractions and the at-risk percent', () => {
    const { samples } = sdRiskBacktestSamples([ticket()], {
      scales: { priority: 0, severity: 0 },
      atRiskPercent: 60,
      fractions: [0.5],
    })

    expect(samples).toHaveLength(1)
    expect(samples[0].at).toEqual(h(4))
  })
})

describe('sdMedian', () => {
  it('should take the middle value or the mean of the two middle ones', () => {
    expect(sdMedian([])).toBeNull()
    expect(sdMedian([5, 1, 3])).toBe(3)
    expect(sdMedian([4, 1, 3, 2])).toBe(2.5)
  })
})

describe('sdRiskBacktestMetrics', () => {
  const samples: SdRiskBacktestSample[] = [
    // t1 violou às 10 h: alto às 4 h e às 6 h, médio às 2 h.
    sample({
      ticketId: 't1',
      at: h(2),
      level: 'MEDIUM',
      score: 50,
      breached: true,
      breachAt: h(10),
    }),
    sample({
      ticketId: 't1',
      at: h(6),
      level: 'HIGH',
      score: 80,
      breached: true,
      breachAt: h(10),
    }),
    sample({
      ticketId: 't1',
      at: h(4),
      level: 'HIGH',
      score: 75,
      breached: true,
      breachAt: h(10),
    }),
    // t2 violou às 3 h sem nunca passar do baixo.
    sample({
      ticketId: 't2',
      at: h(1),
      level: 'LOW',
      score: 20,
      breached: true,
      breachAt: h(3),
    }),
    // t3 cumpriu, mas deu um alarme falso.
    sample({
      ticketId: 't3',
      at: h(1),
      level: 'HIGH',
      score: 70,
      breached: false,
    }),
    sample({
      ticketId: 't3',
      at: h(2),
      level: 'LOW',
      score: 0,
      breached: false,
    }),
    // t4 violou às 5 h e foi pego 1 h antes.
    sample({
      ticketId: 't4',
      at: h(4),
      level: 'HIGH',
      score: 90,
      breached: true,
      breachAt: h(5),
    }),
  ]
  const report = sdRiskBacktestMetrics(samples)

  it('should calibrate each band by its real breach rate', () => {
    expect(report.tickets).toBe(4)
    expect(report.samples).toBe(7)
    expect(report.breachedTickets).toBe(3)
    expect(report.bands).toEqual([
      { level: 'LOW', samples: 2, breached: 1, breachRate: 0.5, meanScore: 10 },
      {
        level: 'MEDIUM',
        samples: 1,
        breached: 1,
        breachRate: 1,
        meanScore: 50,
      },
      {
        level: 'HIGH',
        samples: 4,
        breached: 3,
        breachRate: 0.75,
        meanScore: 78.75,
      },
    ])
  })

  it('should score the high band as an alarm', () => {
    expect(report.high).toEqual({
      truePositives: 3,
      falsePositives: 1,
      falseNegatives: 2,
      trueNegatives: 1,
      precision: 0.75,
      recall: 0.6,
    })
  })

  it('should measure the lead time from the first high snapshot', () => {
    // t1: 10 h − 4 h = 6 h; t4: 1 h. t2 nunca foi alto.
    expect(report.leadTime).toEqual({
      caught: 2,
      breachedTickets: 3,
      minMinutes: 60,
      medianMinutes: 210,
      meanMinutes: 210,
      maxMinutes: 360,
    })
  })

  it('should report nothing on an empty run instead of dividing by zero', () => {
    const empty = sdRiskBacktestMetrics([])

    expect(empty.tickets).toBe(0)
    expect(
      empty.bands.every((b) => b.breachRate === null && b.meanScore === null),
    ).toBe(true)
    expect(empty.high.precision).toBeNull()
    expect(empty.high.recall).toBeNull()
    expect(empty.leadTime).toEqual({
      caught: 0,
      breachedTickets: 0,
      minMinutes: null,
      medianMinutes: null,
      meanMinutes: null,
      maxMinutes: null,
    })
  })

  it('should accept the ticket count from the caller', () => {
    expect(sdRiskBacktestMetrics(samples, 9).tickets).toBe(9)
  })
})

describe('formatSdRiskBacktestReport', () => {
  it('should print the three measures in pt-BR', () => {
    const text = formatSdRiskBacktestReport(
      sdRiskBacktestMetrics([
        sample({ level: 'HIGH', score: 80, breached: true, breachAt: h(3) }),
        sample({ ticketId: 't2', level: 'LOW', score: 5 }),
      ]),
      'Acme (acme)',
    )

    expect(text).toContain('Backtest do risco preditivo — Acme (acme)')
    expect(text).toContain('alto')
    expect(text).toContain('100.0%')
    expect(text).toContain('precisão 100.0% · revocação 100.0%')
    expect(text).toContain('1 de 1 chamados violados')
    expect(text).toContain('mediana 2.0 h')
  })

  it('should print a dash where there is no data', () => {
    const text = formatSdRiskBacktestReport(sdRiskBacktestMetrics([]), 'Vazio')

    expect(text).toContain('precisão — · revocação —')
    expect(text).toContain('nota média —')
    expect(text).toContain('mediana —')
  })
})
