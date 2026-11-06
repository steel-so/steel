import { describe, expect, it } from 'vitest'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import {
  type AgentClosedAggregate,
  agentReportCsvFileName,
  agentReportPresetRange,
  agentReportToCsv,
  averageSeconds,
  buildAgentReport,
  mergeStatusCounts,
  resolveAgentReportPeriod,
  saoPauloDay,
  shiftDay,
  startOfSaoPauloDay,
  successRate,
} from '@/src/lib/whatsapp/agent-report'

describe('São Paulo days', () => {
  it('reads the day in São Paulo, not in UTC', () => {
    // 02:30 UTC on the 7th is still 23:30 on the 6th in São Paulo.
    expect(saoPauloDay(new Date('2026-11-07T02:30:00.000Z'))).toBe('2026-11-06')
    expect(saoPauloDay(new Date('2026-11-07T03:00:00.000Z'))).toBe('2026-11-07')
  })

  it('shifts calendar days across month and year ends', () => {
    expect(shiftDay('2026-11-01', -1)).toBe('2026-10-31')
    expect(shiftDay('2026-01-01', -1)).toBe('2025-12-31')
    expect(shiftDay('2026-02-27', 2)).toBe('2026-03-01')
  })

  it('starts a day at São Paulo midnight', () => {
    expect(startOfSaoPauloDay('2026-11-06').toISOString()).toBe(
      '2026-11-06T03:00:00.000Z',
    )
  })
})

describe('agentReportPresetRange', () => {
  const now = new Date('2026-11-07T02:30:00.000Z') // 06/11 23:30 in São Paulo

  it('today is the São Paulo day', () => {
    expect(agentReportPresetRange('today', now)).toEqual({
      from: '2026-11-06',
      to: '2026-11-06',
    })
  })

  it('7d and 30d include today', () => {
    expect(agentReportPresetRange('7d', now)).toEqual({
      from: '2026-10-31',
      to: '2026-11-06',
    })
    expect(agentReportPresetRange('30d', now)).toEqual({
      from: '2026-10-08',
      to: '2026-11-06',
    })
  })

  it('month starts on the 1st', () => {
    expect(agentReportPresetRange('month', now)).toEqual({
      from: '2026-11-01',
      to: '2026-11-06',
    })
  })
})

describe('resolveAgentReportPeriod', () => {
  const now = new Date('2026-11-07T02:30:00.000Z') // still 06/11 in São Paulo

  it('defaults to the last 7 days ending today (São Paulo)', () => {
    const period = expectOk(resolveAgentReportPeriod({}, now))
    expect(period.fromDay).toBe('2026-10-31')
    expect(period.toDay).toBe('2026-11-06')
    expect(period.start.toISOString()).toBe('2026-10-31T03:00:00.000Z')
    expect(period.endExclusive.toISOString()).toBe('2026-11-07T03:00:00.000Z')
  })

  it('crosses São Paulo midnight: 02:59 UTC is still the previous day', () => {
    const period = expectOk(
      resolveAgentReportPeriod({}, new Date('2026-11-07T02:59:59.999Z')),
    )
    expect(period.toDay).toBe('2026-11-06')
    // A conversation closed at 02:59:59 UTC is inside the period...
    expect(new Date('2026-11-07T02:59:59.000Z') < period.endExclusive).toBe(
      true,
    )
    // ...and one closed at 03:00 UTC (00:00 on the 7th) is outside.
    expect(new Date('2026-11-07T03:00:00.000Z') < period.endExclusive).toBe(
      false,
    )
  })

  it('makes both bounds inclusive days', () => {
    const period = expectOk(
      resolveAgentReportPeriod({ from: '2026-11-03', to: '2026-11-03' }, now),
    )
    expect(period.endExclusive.getTime() - period.start.getTime()).toBe(
      24 * 60 * 60 * 1000,
    )
  })

  it('anchors the default start on a given end day', () => {
    const period = expectOk(resolveAgentReportPeriod({ to: '2026-10-10' }, now))
    expect(period.fromDay).toBe('2026-10-04')
  })

  it('rejects an inverted range', () => {
    expectErr(
      resolveAgentReportPeriod({ from: '2026-11-05', to: '2026-11-01' }, now),
      'VALIDATION_ERROR',
    )
  })

  it('accepts a full year and rejects more', () => {
    expectOk(
      resolveAgentReportPeriod({ from: '2025-11-07', to: '2026-11-07' }, now),
    )
    expectErr(
      resolveAgentReportPeriod({ from: '2025-01-01', to: '2026-11-07' }, now),
      'VALIDATION_ERROR',
    )
  })
})

describe('rates and averages', () => {
  it('computes the success rate over the tabulated, one decimal', () => {
    expect(successRate(1, 2)).toBe(33.3)
    expect(successRate(2, 1)).toBe(66.7)
    expect(successRate(5, 0)).toBe(100)
    expect(successRate(0, 4)).toBe(0)
  })

  it('has no rate without tabulated conversations (no division by zero)', () => {
    expect(successRate(0, 0)).toBeNull()
  })

  it('averages in whole seconds and is null without conversations', () => {
    expect(averageSeconds(100, 3)).toBe(33)
    expect(averageSeconds(0, 4)).toBe(0)
    expect(averageSeconds(50, 0)).toBeNull()
  })
})

describe('mergeStatusCounts', () => {
  it('sums the same label, most used first, ties by label', () => {
    expect(
      mergeStatusCounts([
        { label: 'Sem interesse', outcome: 'FAILURE', count: 2 },
        { label: 'Venda', outcome: 'SUCCESS', count: 1 },
        { label: 'Venda', outcome: 'SUCCESS', count: 4 },
        { label: 'Agendado', outcome: 'SUCCESS', count: 2 },
      ]),
    ).toEqual([
      { label: 'Venda', outcome: 'SUCCESS', count: 5 },
      { label: 'Agendado', outcome: 'SUCCESS', count: 2 },
      { label: 'Sem interesse', outcome: 'FAILURE', count: 2 },
    ])
  })

  it('keeps the outcome with more conversations when a label changed', () => {
    expect(
      mergeStatusCounts([
        { label: 'Retorno', outcome: 'FAILURE', count: 1 },
        { label: 'Retorno', outcome: 'SUCCESS', count: 3 },
        { label: 'Retorno', outcome: null, count: 9 },
      ]),
    ).toEqual([{ label: 'Retorno', outcome: 'SUCCESS', count: 13 }])
  })

  it('has a null outcome when the status no longer exists', () => {
    expect(
      mergeStatusCounts([{ label: 'Antigo', outcome: null, count: 1 }]),
    ).toEqual([{ label: 'Antigo', outcome: null, count: 1 }])
  })
})

const closed = (
  agentId: string | null,
  values: Partial<AgentClosedAggregate>,
): AgentClosedAggregate => ({
  agentId,
  closed: 0,
  success: 0,
  failure: 0,
  untabulated: 0,
  handlingSeconds: 0,
  ...values,
})

describe('buildAgentReport', () => {
  const names = new Map([
    ['u1', 'Ana'],
    ['u2', 'Bruno'],
  ])
  const body = buildAgentReport({
    agentNames: names,
    closed: [
      closed('u1', {
        closed: 4,
        success: 2,
        failure: 1,
        untabulated: 1,
        handlingSeconds: 4000,
      }),
      closed('u2', {
        closed: 6,
        success: 6,
        handlingSeconds: 1200,
      }),
      closed(null, { closed: 1, untabulated: 1, handlingSeconds: 60 }),
      closed('gone', { closed: 1, failure: 1, handlingSeconds: 10 }),
    ],
    open: [
      { agentId: 'u1', open: 3 },
      { agentId: 'u3', open: 2 },
      { agentId: null, open: 1 },
    ],
    statuses: [
      { agentId: 'u1', label: 'Venda', outcome: 'SUCCESS', count: 2 },
      { agentId: 'u1', label: 'Sem interesse', outcome: 'FAILURE', count: 1 },
      { agentId: 'u1', label: 'Retorno', outcome: 'SUCCESS', count: 1 },
      { agentId: 'u2', label: 'Venda', outcome: 'SUCCESS', count: 6 },
    ],
  })

  it('builds one row per agent with closed or open conversations', () => {
    expect(body.rows.map((row) => row.agentId)).toEqual([
      'u2',
      'u1',
      'gone',
      'u3',
      null,
    ])
  })

  it('puts "Sem atendente" last and names unknown assignees', () => {
    expect(body.rows.at(-1)?.agentName).toBe('Sem atendente')
    expect(body.rows.find((row) => row.agentId === 'gone')?.agentName).toBe(
      'Atendente removido',
    )
  })

  it('computes the metrics of an agent', () => {
    const ana = body.rows.find((row) => row.agentId === 'u1')
    expect(ana).toMatchObject({
      agentName: 'Ana',
      closed: 4,
      tabulated: 3,
      success: 2,
      failure: 1,
      successRate: 66.7,
      untabulated: 1,
      avgHandlingSeconds: 1000,
      open: 3,
    })
    expect(ana?.byStatus).toEqual([
      { label: 'Venda', outcome: 'SUCCESS', count: 2 },
      { label: 'Retorno', outcome: 'SUCCESS', count: 1 },
      { label: 'Sem interesse', outcome: 'FAILURE', count: 1 },
    ])
  })

  it('an agent who only holds open conversations has empty rates', () => {
    expect(body.rows.find((row) => row.agentId === 'u3')).toMatchObject({
      closed: 0,
      successRate: null,
      avgHandlingSeconds: null,
      open: 2,
      byStatus: [],
    })
  })

  it('totals weigh the average by conversation, not by agent', () => {
    expect(body.totals).toMatchObject({
      closed: 12,
      success: 8,
      failure: 2,
      tabulated: 10,
      successRate: 80,
      untabulated: 2,
      // (4000 + 1200 + 60 + 10) / 12
      avgHandlingSeconds: 439,
      open: 6,
    })
    expect(body.statuses).toEqual([
      { label: 'Venda', outcome: 'SUCCESS', count: 8 },
      { label: 'Retorno', outcome: 'SUCCESS', count: 1 },
      { label: 'Sem interesse', outcome: 'FAILURE', count: 1 },
    ])
  })

  it('an empty period yields no rows and empty totals', () => {
    const empty = buildAgentReport({
      agentNames: names,
      closed: [],
      open: [],
      statuses: [],
    })
    expect(empty.rows).toEqual([])
    expect(empty.totals).toMatchObject({
      closed: 0,
      successRate: null,
      avgHandlingSeconds: null,
      open: 0,
    })
  })
})

describe('agentReportToCsv', () => {
  const body = buildAgentReport({
    agentNames: new Map([['u1', 'Ana; "Líder"']]),
    closed: [
      closed('u1', {
        closed: 3,
        success: 1,
        failure: 1,
        untabulated: 1,
        handlingSeconds: 3600,
      }),
    ],
    open: [{ agentId: 'u1', open: 2 }],
    statuses: [
      { agentId: 'u1', label: 'Venda', outcome: 'SUCCESS', count: 1 },
      { agentId: 'u1', label: '=Sem interesse', outcome: 'FAILURE', count: 1 },
    ],
  })
  const csv = agentReportToCsv({
    fromDay: '2026-11-01',
    toDay: '2026-11-07',
    timeZone: 'America/Sao_Paulo',
    teamId: null,
    connectionId: null,
    visibility: 'ALL',
    ...body,
  })
  const lines = csv.slice(1).split('\r\n')

  it('starts with the BOM and uses ";" and CRLF', () => {
    expect(csv.startsWith('﻿')).toBe(true)
    expect(lines[0]).toBe(
      'Atendente;Encerradas;Tabuladas;Sucesso;Insucesso;Taxa de sucesso (%);Sem tabulação;Tempo médio de atendimento (min);Em aberto;Status: =Sem interesse;Status: Venda',
    )
    expect(csv.endsWith('\r\n')).toBe(true)
  })

  it('writes a line per agent and a total, pt-BR decimals', () => {
    expect(lines[1]).toBe('"Ana; ""Líder""";3;2;1;1;50;1;20,0;2;1;1')
    expect(lines[2]).toBe('Total;3;2;1;1;50;1;20,0;2;1;1')
  })

  it('neutralizes names that a spreadsheet would run as a formula', () => {
    const risky = agentReportToCsv({
      fromDay: '2026-11-01',
      toDay: '2026-11-07',
      timeZone: 'America/Sao_Paulo',
      teamId: null,
      connectionId: null,
      visibility: 'ALL',
      ...buildAgentReport({
        agentNames: new Map([['u1', '=SUM(A1)']]),
        closed: [closed('u1', { closed: 1, untabulated: 1 })],
        open: [],
        statuses: [],
      }),
    })
    expect(risky.slice(1).split('\r\n')[1].startsWith("'=SUM(A1);")).toBe(true)
  })

  it('leaves rates and times empty when there is nothing to average', () => {
    const empty = agentReportToCsv({
      fromDay: '2026-11-01',
      toDay: '2026-11-07',
      timeZone: 'America/Sao_Paulo',
      teamId: null,
      connectionId: null,
      visibility: 'SELF',
      ...buildAgentReport({
        agentNames: new Map(),
        closed: [],
        open: [],
        statuses: [],
      }),
    })
    expect(empty.slice(1).split('\r\n')[1]).toBe('Total;0;0;0;0;;0;;0')
  })

  it('names the file after the period', () => {
    expect(
      agentReportCsvFileName({ fromDay: '2026-11-01', toDay: '2026-11-07' }),
    ).toBe('relatorio-atendentes-2026-11-01-a-2026-11-07.csv')
  })
})
