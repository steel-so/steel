import { describe, expect, it } from 'vitest'
import {
  createFakeSdRiskStats,
  createFakeSdRiskTicket,
} from '@/src/__tests__/factories/sd-risk.factory'
import {
  SD_RISK_THRESHOLDS,
  type SdRiskFactorKey,
} from '@/src/lib/servicedesk/risk'
import {
  computeSdRiskPrediction,
  SD_RISK_TUNING,
  type SdRiskPredictionResult,
  sdRiskBreachEta,
  sdRiskDuration,
  sdRiskEmptyStats,
} from '@/src/lib/servicedesk/risk-compute'
import type { SdCalendar } from '@/src/lib/servicedesk/sla'

/**
 * Heurística de risco (ADR 0016). O chamado da fábrica não aciona nenhum
 * fator: cada teste liga **um** fator e confere os pontos e a frase.
 */

const NOW = new Date('2026-10-02T12:00:00.000Z')
const HOUR = 60 * 60 * 1000

function at(hoursAgo: number): Date {
  return new Date(NOW.getTime() - hoursAgo * HOUR)
}

function predict(
  ticket: Parameters<typeof createFakeSdRiskTicket>[0],
  stats = createFakeSdRiskStats(),
  options?: { atRiskPercent?: number; calendar?: SdCalendar | null },
): SdRiskPredictionResult {
  return computeSdRiskPrediction(
    createFakeSdRiskTicket(ticket),
    stats,
    NOW,
    options,
  )
}

function factorOf(result: SdRiskPredictionResult, key: SdRiskFactorKey) {
  return result.factors.find((f) => f.key === key)
}

/** Expediente 09:00–18:00 de segunda a sexta, fuso de São Paulo. */
const BUSINESS: SdCalendar = {
  timezone: 'America/Sao_Paulo',
  schedule: {
    mon: [['09:00', '18:00']],
    tue: [['09:00', '18:00']],
    wed: [['09:00', '18:00']],
    thu: [['09:00', '18:00']],
    fri: [['09:00', '18:00']],
  },
  holidays: [],
  is24x7: false,
}

describe('sdRiskDuration', () => {
  it('should speak minutes, hours and days in pt-BR', () => {
    expect(sdRiskDuration(0)).toBe('0 min')
    expect(sdRiskDuration(45)).toBe('45 min')
    expect(sdRiskDuration(180)).toBe('3 h')
    expect(sdRiskDuration(60 * 48)).toBe('2 d')
  })

  it('should never show a negative duration', () => {
    expect(sdRiskDuration(-10)).toBe('0 min')
  })
})

describe('computeSdRiskPrediction — chamado tranquilo', () => {
  it('should score zero and explain nothing when no factor applies', () => {
    const result = predict({})

    expect(result.score).toBe(0)
    expect(result.level).toBe('LOW')
    expect(result.factors).toEqual([])
    expect(result.breachEtaAt).toBeNull()
  })

  it('should start from the empty stats helper', () => {
    const stats = sdRiskEmptyStats()

    expect(stats.maxPriorityLevel).toBe(0)
    expect(stats.breachedCustomerIds.size).toBe(0)
    expect(predict({}, stats).factors).toEqual([])
  })
})

describe('fator sla_consumed', () => {
  it('should not apply below the ramp start', () => {
    // Prazo de 10 h, aberto há 4 h: 40% consumido.
    const result = predict({
      createdAt: at(4),
      resolutionDueAt: new Date(NOW.getTime() + 6 * HOUR),
    })

    expect(factorOf(result, 'sla_consumed')).toBeUndefined()
  })

  it('should grade the points by the percent already consumed', () => {
    // Prazo de 10 h, aberto há 8 h: 80% → 60% da rampa (50→100).
    const result = predict({
      createdAt: at(8),
      resolutionDueAt: new Date(NOW.getTime() + 2 * HOUR),
    })
    const factor = factorOf(result, 'sla_consumed')

    expect(factor?.weight).toBe(18)
    expect(factor?.detail).toBe(
      '80% do prazo de resolução consumido (em horário útil)',
    )
  })

  it('should give the whole weight to a breached deadline', () => {
    const result = predict({
      createdAt: at(10),
      resolutionDueAt: at(1),
    })

    expect(factorOf(result, 'sla_consumed')).toMatchObject({
      weight: 30,
      detail: 'Prazo de resolução já violado',
    })
  })

  it('should fall back to the first response timer when there is no resolution deadline', () => {
    const result = predict({
      createdAt: at(8),
      firstResponseDueAt: new Date(NOW.getTime() + 2 * HOUR),
    })

    expect(factorOf(result, 'sla_consumed')?.detail).toContain(
      'prazo de 1ª resposta',
    )
  })

  it('should weigh the first response while nobody has answered, even with a resolution deadline', () => {
    // 1ª resposta: prazo de 2 h, aberto há 1 h 48 → 90%. Resolução: 10 h → 18%.
    const result = predict({
      createdAt: new Date(NOW.getTime() - 108 * 60 * 1000),
      firstResponseDueAt: new Date(NOW.getTime() + 12 * 60 * 1000),
      resolutionDueAt: new Date(NOW.getTime() + (10 * 60 - 108) * 60 * 1000),
    })

    expect(factorOf(result, 'sla_consumed')).toMatchObject({
      weight: 24,
      detail: '90% do prazo de 1ª resposta consumido (em horário útil)',
    })
    // A previsão é o primeiro prazo a estourar: o da 1ª resposta.
    expect(result.breachEtaAt?.toISOString()).toBe(
      new Date(NOW.getTime() + 12 * 60 * 1000).toISOString(),
    )
  })

  it('should call a missed first response violated while the resolution still runs', () => {
    const result = predict({
      createdAt: at(3),
      firstResponseDueAt: at(1),
      resolutionDueAt: new Date(NOW.getTime() + 20 * HOUR),
    })

    expect(factorOf(result, 'sla_consumed')).toMatchObject({
      weight: 30,
      detail: 'Prazo de 1ª resposta já violado',
    })
    expect(result.breachEtaAt?.toISOString()).toBe(at(1).toISOString())
  })

  it('should keep the resolution when it is the more urgent clock', () => {
    // Resolução: 8 h de 10 h (80%). 1ª resposta: 8 h de 40 h (20%).
    const result = predict({
      createdAt: at(8),
      firstResponseDueAt: new Date(NOW.getTime() + 32 * HOUR),
      resolutionDueAt: new Date(NOW.getTime() + 2 * HOUR),
    })

    expect(factorOf(result, 'sla_consumed')?.detail).toBe(
      '80% do prazo de resolução consumido (em horário útil)',
    )
    expect(result.breachEtaAt?.toISOString()).toBe(
      new Date(NOW.getTime() + 2 * HOUR).toISOString(),
    )
  })

  it('should drop the first response once it was answered', () => {
    // Respondido a tempo: só a resolução (30%) conta — e não pontua.
    const result = predict({
      createdAt: at(3),
      firstResponseDueAt: at(1),
      firstRespondedAt: at(2),
      resolutionDueAt: new Date(NOW.getTime() + 7 * HOUR),
    })

    expect(factorOf(result, 'sla_consumed')).toBeUndefined()
    expect(result.breachEtaAt?.toISOString()).toBe(
      new Date(NOW.getTime() + 7 * HOUR).toISOString(),
    )
  })

  it('should keep the resolution label on a tie', () => {
    const result = predict({
      createdAt: at(8),
      firstResponseDueAt: new Date(NOW.getTime() + 2 * HOUR),
      resolutionDueAt: new Date(NOW.getTime() + 2 * HOUR),
    })

    expect(factorOf(result, 'sla_consumed')?.detail).toContain(
      'prazo de resolução',
    )
  })

  it('should ignore a paused clock', () => {
    const result = predict({
      createdAt: at(10),
      resolutionDueAt: new Date(NOW.getTime() + 1 * HOUR),
      slaPausedAt: at(1),
      phase: {
        name: 'Aguardando cliente',
        category: 'WAITING',
        pausesSla: true,
      },
    })

    expect(factorOf(result, 'sla_consumed')).toBeUndefined()
    expect(result.breachEtaAt).toBeNull()
  })

  it('should ignore a deadline already met', () => {
    const result = predict({
      createdAt: at(10),
      firstResponseDueAt: at(8),
      firstRespondedAt: at(9),
    })

    expect(factorOf(result, 'sla_consumed')).toBeUndefined()
  })
})

describe('fator unassigned', () => {
  it('should grade by how long the ticket has had no owner', () => {
    const result = predict({ assigneeId: null, createdAt: at(1) })

    // 1 h de 4 h → 25% de 12 pontos.
    expect(factorOf(result, 'unassigned')).toMatchObject({
      weight: 3,
      detail: 'Sem responsável há 1 h',
    })
  })

  it('should saturate after the tuning window', () => {
    const result = predict({
      assigneeId: null,
      createdAt: at(SD_RISK_TUNING.unassignedFullHours + 2),
    })

    expect(factorOf(result, 'unassigned')?.weight).toBe(12)
  })

  it('should not apply to an assigned ticket', () => {
    expect(
      factorOf(predict({ assigneeId: 'u9' }), 'unassigned'),
    ).toBeUndefined()
  })
})

describe('fator priority', () => {
  const stats = createFakeSdRiskStats({
    maxPriorityLevel: 4,
    maxSeverityLevel: 3,
  })

  it('should give the whole weight to the top of the scale', () => {
    const result = predict(
      { priority: { name: 'P1 – Crítica', level: 4 } },
      stats,
    )

    expect(factorOf(result, 'priority')).toMatchObject({
      weight: 12,
      detail: 'Prioridade P1 – Crítica',
    })
  })

  it('should grade the middle of the scale', () => {
    const result = predict(
      { priority: { name: 'P3 – Média', level: 2 } },
      stats,
    )

    expect(factorOf(result, 'priority')?.weight).toBe(4)
  })

  it('should take the severity when it is worse than the priority', () => {
    const result = predict(
      {
        priority: { name: 'P4 – Baixa', level: 1 },
        severity: { name: 'Crítica', level: 3 },
      },
      stats,
    )

    expect(factorOf(result, 'priority')).toMatchObject({
      weight: 12,
      detail: 'Severidade Crítica',
    })
  })

  it('should not apply at the bottom of the scale', () => {
    const result = predict(
      { priority: { name: 'P4 – Baixa', level: 1 } },
      stats,
    )

    expect(factorOf(result, 'priority')).toBeUndefined()
  })

  it('should not apply when the workspace has a single step', () => {
    const result = predict(
      { priority: { name: 'Única', level: 1 } },
      createFakeSdRiskStats({ maxPriorityLevel: 1 }),
    )

    expect(factorOf(result, 'priority')).toBeUndefined()
  })
})

describe('fator stale', () => {
  it('should not apply inside the quiet window', () => {
    const result = predict({ lastTeamActivityAt: at(4) })

    expect(factorOf(result, 'stale')).toBeUndefined()
  })

  it('should grade the silence of the team', () => {
    const result = predict({ lastTeamActivityAt: at(28) })

    // 28 h na rampa 8→48 → 50% de 12 pontos.
    expect(factorOf(result, 'stale')).toMatchObject({
      weight: 6,
      detail: 'Sem interação da equipe há 1 d',
    })
  })

  it('should count the silence from the opening when the team never acted', () => {
    const result = predict({ createdAt: at(28), lastTeamActivityAt: null })

    expect(factorOf(result, 'stale')).toMatchObject({
      weight: 6,
      detail: 'Sem interação da equipe há 1 d',
    })
  })

  it('should survive a broken date instead of scoring NaN', () => {
    const result = predict({ lastTeamActivityAt: new Date(Number.NaN) })

    expect(factorOf(result, 'stale')).toBeUndefined()
    expect(result.score).toBe(0)
  })
})

describe('fator reopened', () => {
  it('should give half the weight to the first reopen', () => {
    expect(factorOf(predict({ reopenCount: 1 }), 'reopened')).toMatchObject({
      weight: 4,
      detail: 'Já foi reaberto uma vez',
    })
  })

  it('should saturate from the second reopen on', () => {
    expect(factorOf(predict({ reopenCount: 3 }), 'reopened')).toMatchObject({
      weight: 8,
      detail: 'Já foi reaberto 3 vezes',
    })
  })

  it('should not apply to a ticket never reopened', () => {
    expect(factorOf(predict({ reopenCount: 0 }), 'reopened')).toBeUndefined()
  })
})

describe('fator queue_pressure', () => {
  it('should apply when the department queue is above the workspace average', () => {
    const result = predict(
      { departmentId: 'd1' },
      createFakeSdRiskStats({ openByDepartment: { d1: 20, d2: 10, d3: 0 } }),
    )

    // Média 10, fila 20 → 2× → peso cheio.
    expect(factorOf(result, 'queue_pressure')).toMatchObject({
      weight: 8,
      detail: 'Fila do time com 20 chamados abertos (média do workspace: 10)',
    })
  })

  it('should grade a queue just above the average', () => {
    const result = predict(
      { departmentId: 'd1' },
      createFakeSdRiskStats({ openByDepartment: { d1: 12, d2: 8 } }),
    )

    expect(factorOf(result, 'queue_pressure')?.weight).toBe(2)
  })

  it('should not apply to a queue at or below the average', () => {
    const result = predict(
      { departmentId: 'd2' },
      createFakeSdRiskStats({ openByDepartment: { d1: 12, d2: 8 } }),
    )

    expect(factorOf(result, 'queue_pressure')).toBeUndefined()
  })

  it('should not apply to a department the stats never saw', () => {
    const result = predict(
      { departmentId: 'novo' },
      createFakeSdRiskStats({ openByDepartment: { d1: 12, d2: 8 } }),
    )

    expect(factorOf(result, 'queue_pressure')).toBeUndefined()
  })

  it('should not apply without a department', () => {
    const result = predict(
      { departmentId: null },
      createFakeSdRiskStats({ openByDepartment: { d1: 50 } }),
    )

    expect(factorOf(result, 'queue_pressure')).toBeUndefined()
  })
})

describe('fator waiting_third_party', () => {
  it('should apply when the phase waits but the clock keeps running', () => {
    const result = predict({
      phase: {
        name: 'Aguardando fornecedor',
        category: 'WAITING',
        pausesSla: false,
      },
    })

    expect(factorOf(result, 'waiting_third_party')).toMatchObject({
      weight: 6,
      detail: 'Em "Aguardando fornecedor" com o prazo correndo',
    })
  })

  it('should not apply when the phase pauses the clock', () => {
    const result = predict({
      phase: {
        name: 'Aguardando cliente',
        category: 'WAITING',
        pausesSla: true,
      },
    })

    expect(factorOf(result, 'waiting_third_party')).toBeUndefined()
  })

  it('should not apply outside a waiting phase', () => {
    expect(factorOf(predict({}), 'waiting_third_party')).toBeUndefined()
  })
})

describe('fator assignee_load', () => {
  it('should apply when the owner carries more than the average', () => {
    const result = predict(
      { assigneeId: 'u1' },
      createFakeSdRiskStats({ openByAssignee: { u1: 20, u2: 10, u3: 0 } }),
    )

    expect(factorOf(result, 'assignee_load')).toMatchObject({
      weight: 6,
      detail: 'Responsável com 20 chamados abertos (média: 10)',
    })
  })

  it('should not apply to an owner at the average', () => {
    const result = predict(
      { assigneeId: 'u1' },
      createFakeSdRiskStats({ openByAssignee: { u1: 10, u2: 10 } }),
    )

    expect(factorOf(result, 'assignee_load')).toBeUndefined()
  })

  it('should not apply without an owner', () => {
    const result = predict(
      { assigneeId: null },
      createFakeSdRiskStats({ openByAssignee: { u1: 99 } }),
    )

    expect(factorOf(result, 'assignee_load')).toBeUndefined()
  })
})

describe('fator history', () => {
  it('should apply at half weight for the customer history', () => {
    const result = predict(
      { customerId: 'c1' },
      createFakeSdRiskStats({ breachedCustomerIds: new Set(['c1']) }),
    )

    expect(factorOf(result, 'history')).toMatchObject({
      weight: 3,
      detail: 'Este cliente já teve prazo violado antes',
    })
  })

  it('should read the company when there is no customer', () => {
    const result = predict(
      { companyId: 'c2' },
      createFakeSdRiskStats({ breachedCustomerIds: new Set(['c2']) }),
    )

    expect(factorOf(result, 'history')?.detail).toBe(
      'Este cliente já teve prazo violado antes',
    )
  })

  it('should apply at half weight for the service history', () => {
    const result = predict(
      { serviceId: 's1' },
      createFakeSdRiskStats({ breachedServiceIds: new Set(['s1']) }),
    )

    expect(factorOf(result, 'history')?.detail).toBe(
      'Este serviço já teve prazo violado antes',
    )
  })

  it('should give the whole weight when customer and service both have history', () => {
    const result = predict(
      { customerId: 'c1', serviceId: 's1' },
      createFakeSdRiskStats({
        breachedCustomerIds: new Set(['c1']),
        breachedServiceIds: new Set(['s1']),
      }),
    )

    expect(factorOf(result, 'history')).toMatchObject({
      weight: 6,
      detail: 'Este cliente e este serviço já tiveram prazo violado antes',
    })
  })

  it('should not apply without any history', () => {
    const result = predict(
      { customerId: 'c1', serviceId: 's1' },
      createFakeSdRiskStats(),
    )

    expect(factorOf(result, 'history')).toBeUndefined()
  })
})

describe('faixas', () => {
  it('should land on MEDIUM exactly at the threshold', () => {
    // 30 (prazo violado) + 12 (sem responsável há 5 h) = 42 … ajustado:
    // 12 (sem responsável) + 8 (reaberto 2×) + 12 (prioridade máxima)
    // + 8 (fila) = 40, o corte exato.
    const result = predict(
      {
        assigneeId: null,
        createdAt: at(5),
        reopenCount: 2,
        priority: { name: 'P1', level: 4 },
        departmentId: 'd1',
      },
      createFakeSdRiskStats({
        maxPriorityLevel: 4,
        openByDepartment: { d1: 20, d2: 10, d3: 0 },
      }),
    )

    expect(result.score).toBe(SD_RISK_THRESHOLDS.medium)
    expect(result.level).toBe('MEDIUM')
  })

  it('should land on HIGH exactly at the threshold', () => {
    // 30 (prazo violado) + 12 (sem responsável) + 12 (prioridade máxima)
    // + 12 (parado há 48 h+) + 4 (reaberto 1×) = 70.
    const result = predict(
      {
        createdAt: at(72),
        resolutionDueAt: at(2),
        assigneeId: null,
        priority: { name: 'P1', level: 4 },
        lastTeamActivityAt: at(60),
        reopenCount: 1,
      },
      createFakeSdRiskStats({ maxPriorityLevel: 4 }),
    )

    expect(result.score).toBe(SD_RISK_THRESHOLDS.high)
    expect(result.level).toBe('HIGH')
  })

  it('should never go past 100 even with every factor at the top', () => {
    const result = predict(
      {
        createdAt: at(100),
        resolutionDueAt: at(10),
        assigneeId: null,
        departmentId: 'd1',
        customerId: 'c1',
        serviceId: 's1',
        reopenCount: 5,
        lastTeamActivityAt: at(90),
        priority: { name: 'P1', level: 4 },
        severity: { name: 'Crítica', level: 3 },
        phase: { name: 'Aguardando', category: 'WAITING', pausesSla: false },
      },
      createFakeSdRiskStats({
        maxPriorityLevel: 4,
        maxSeverityLevel: 3,
        openByDepartment: { d1: 30, d2: 5 },
        breachedCustomerIds: new Set(['c1']),
        breachedServiceIds: new Set(['s1']),
      }),
    )

    expect(result.score).toBeLessThanOrEqual(100)
    expect(result.level).toBe('HIGH')
    // Sem responsável: a carga do responsável não entra.
    expect(factorOf(result, 'assignee_load')).toBeUndefined()
    expect(result.factors.every((f) => f.detail.length > 0)).toBe(true)
  })
})

describe('sdRiskBreachEta', () => {
  it('should spend the remaining business minutes over the calendar', () => {
    // Sexta 17:50 em São Paulo (20:50 UTC) com 30 min úteis restantes:
    // 10 min na sexta e 20 min na segunda, às 09:20 local (12:20 UTC).
    const friday = new Date('2026-10-02T20:50:00.000Z')
    const eta = sdRiskBreachEta(
      {
        dueAt: new Date('2026-10-05T12:20:00.000Z').toISOString(),
        remainingMinutes: 30,
        percentUsed: 70,
        state: 'ok',
      },
      friday,
      BUSINESS,
    )

    expect(eta?.toISOString()).toBe('2026-10-05T12:20:00.000Z')
  })

  it('should return the deadline itself when it is already breached', () => {
    const dueAt = new Date('2026-10-01T12:00:00.000Z')
    const eta = sdRiskBreachEta(
      {
        dueAt: dueAt.toISOString(),
        remainingMinutes: -120,
        percentUsed: 140,
        state: 'breached',
      },
      NOW,
      BUSINESS,
    )

    expect(eta?.toISOString()).toBe(dueAt.toISOString())
  })

  it('should return the deadline when the clock has just run out', () => {
    const dueAt = new Date('2026-10-02T12:00:00.000Z')
    const eta = sdRiskBreachEta(
      {
        dueAt: dueAt.toISOString(),
        remainingMinutes: 0,
        percentUsed: 100,
        state: 'ok',
      },
      NOW,
      BUSINESS,
    )

    expect(eta?.toISOString()).toBe(dueAt.toISOString())
  })

  it('should have no estimate without a deadline, paused, met or without remaining', () => {
    const base = {
      dueAt: NOW.toISOString(),
      remainingMinutes: 60,
      percentUsed: 10,
    }

    expect(
      sdRiskBreachEta({ ...base, state: 'none' }, NOW, BUSINESS),
    ).toBeNull()
    expect(sdRiskBreachEta({ ...base, state: 'met' }, NOW, BUSINESS)).toBeNull()
    expect(
      sdRiskBreachEta({ ...base, state: 'paused' }, NOW, BUSINESS),
    ).toBeNull()
    expect(
      sdRiskBreachEta({ ...base, dueAt: null, state: 'ok' }, NOW, BUSINESS),
    ).toBeNull()
    expect(
      sdRiskBreachEta(
        { ...base, remainingMinutes: null, state: 'ok' },
        NOW,
        BUSINESS,
      ),
    ).toBeNull()
  })

  it('should come out of the prediction already in business hours', () => {
    // Prazo de 4 h úteis aberto às 09:00 de uma sexta; agora são 17:50.
    const result = computeSdRiskPrediction(
      createFakeSdRiskTicket({
        createdAt: new Date('2026-10-02T12:00:00.000Z'),
        resolutionDueAt: new Date('2026-10-02T21:00:00.000Z'),
      }),
      createFakeSdRiskStats(),
      new Date('2026-10-02T20:50:00.000Z'),
      { calendar: BUSINESS },
    )

    expect(result.breachEtaAt?.toISOString()).toBe('2026-10-02T21:00:00.000Z')
  })

  it('should respect the at-risk percent of the workspace', () => {
    const result = predict(
      {
        createdAt: at(8),
        resolutionDueAt: new Date(NOW.getTime() + 2 * HOUR),
      },
      createFakeSdRiskStats(),
      { atRiskPercent: 60 },
    )

    // A faixa de "em risco" não muda a pontuação, só o estado do relógio.
    expect(factorOf(result, 'sla_consumed')?.weight).toBe(18)
  })
})
