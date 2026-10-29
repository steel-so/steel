import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeSdAiClassification,
  createFakeSdAiComparisonTicket,
  createFakeSdAiSuggestion,
  createFakeSdAiTriageRecord,
} from '@/src/__tests__/factories/nov-s9-ai-vs-technician.factory'
import { createFakeSdSettings } from '@/src/__tests__/factories/sd-ticket-context.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { actAs } from '@/src/__tests__/helpers/sd-access.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'
import { DEFAULT_SD_TICKET_PREFIXES } from '@/src/lib/servicedesk/ticket-code'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/sd-access.repository')
vi.mock('@/src/repositories/sd-ai-comparison.repository')
vi.mock('../sd-ticket-engine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../sd-ticket-engine')>()),
  SdTicketEngine: { loadConfig: vi.fn() },
}))

import { SdAiComparisonRepository } from '@/src/repositories/sd-ai-comparison.repository'
import { SdAiComparisonService } from '../sd-ai-comparison.service'
import { SdTicketEngine } from '../sd-ticket-engine'

const repo = vi.mocked(SdAiComparisonRepository)
const engine = vi.mocked(SdTicketEngine)

const WS = 'ws1'
const NOW = new Date('2026-10-25T12:00:00.000Z')
const HOUR = 3_600_000
const QUERY = { days: 30 as const }

function triaged(
  id: string,
  overrides: Partial<Parameters<typeof createFakeSdAiComparisonTicket>[0]> = {},
  record = createFakeSdAiTriageRecord(),
) {
  return createFakeSdAiComparisonTicket({
    id,
    aiTriage: record as never,
    ...overrides,
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  actAs('agent')
  engine.loadConfig.mockResolvedValue(
    ok({
      settings: createFakeSdSettings({ workspaceId: WS }),
      prefixes: DEFAULT_SD_TICKET_PREFIXES,
    }),
  )
  repo.listTriaged.mockResolvedValue(ok([]))
  repo.listSuggestions.mockResolvedValue(ok([]))
  repo.listTicketsByIds.mockResolvedValue(ok([]))
  repo.listAgentMessages.mockResolvedValue(ok([]))
  repo.usageByFeature.mockResolvedValue(ok([]))
  repo.preServiceOutcomes.mockResolvedValue(ok([]))
  repo.userNames.mockResolvedValue(ok([]))
})

describe('SdAiComparisonService.overview', () => {
  it('returns an empty but well-formed panel without data', async () => {
    const dto = expectOk(
      await SdAiComparisonService.overview('u1', WS, QUERY, NOW),
    )
    expect(dto.periodDays).toBe(30)
    expect(dto.to).toBe(NOW.toISOString())
    expect(dto.from).toBe(
      new Date(NOW.getTime() - 30 * 24 * HOUR).toISOString(),
    )
    expect(dto.summary).toEqual({
      triaged: 0,
      settled: 0,
      awaitingReview: 0,
      accuracy: null,
      corrections: 0,
      avgConfidence: null,
    })
    expect(dto.fields).toHaveLength(8)
    expect(dto.texts.map((t) => [t.kind, t.total, t.usageRate])).toEqual([
      ['REPLY', 0, null],
      ['SOLUTION', 0, null],
    ])
    expect(dto.agents).toEqual([])
    expect(dto.divergences).toEqual([])
    expect(dto.preService).toMatchObject({
      conversations: 0,
      deflectionRate: null,
    })
    expect(dto.usage).toMatchObject({
      calls: 0,
      costUsd: 0,
      costPerUsedUsd: null,
    })
    expect(dto.usage.features.map((f) => f.label)).toEqual([
      'Triagem do ServiceDesk',
      'Copiloto do ServiceDesk',
      'Pré-atendimento do ServiceDesk',
    ])
    expect(repo.listTriaged).toHaveBeenCalledWith(
      WS,
      new Date(NOW.getTime() - 30 * 24 * HOUR),
    )
  })

  it('compares triage with the final ticket, skipping canceled and unreviewed ones', async () => {
    const kept = triaged('t-kept', { number: 1 })
    const changed = triaged(
      't-changed',
      {
        number: 2,
        title: 'Impressora',
        category: { id: 'x', name: 'Hardware' },
      },
      createFakeSdAiTriageRecord({
        suggestions: createFakeSdAiClassification({ confidence: 0.4 }),
        at: '2026-10-24T10:00:00.000Z',
      }),
    )
    const open = triaged('t-open', { phaseCategory: 'IN_PROGRESS' })
    const canceled = triaged('t-canceled', { phaseCategory: 'CANCELED' })
    const garbage = createFakeSdAiComparisonTicket({
      aiTriage: 'lixo' as never,
    })
    const noSuggestions = createFakeSdAiComparisonTicket({
      aiTriage: { applied: [] } as never,
    })
    const nullRecord = createFakeSdAiComparisonTicket({ aiTriage: null })
    repo.listTriaged.mockResolvedValue(
      ok([kept, changed, open, canceled, garbage, noSuggestions, nullRecord]),
    )

    const dto = expectOk(
      await SdAiComparisonService.overview('u1', WS, QUERY, NOW),
    )
    expect(dto.summary).toMatchObject({
      triaged: 3,
      settled: 2,
      awaitingReview: 1,
      accuracy: 50,
      corrections: 1,
      avgConfidence: 73,
    })
    expect(dto.fields.find((f) => f.field === 'category')).toMatchObject({
      compared: 2,
      matched: 1,
      corrected: 1,
      accuracy: 50,
    })
    expect(dto.divergences).toEqual([
      expect.objectContaining({
        ticketId: 't-changed',
        code: 'INC-000002',
        title: 'Impressora',
        field: 'category',
        suggested: 'Rede',
        final: 'Hardware',
        appliedByAi: true,
      }),
    ])
    expect(dto.calibration.find((b) => b.band === 'HIGH')).toMatchObject({
      tickets: 1,
      accuracy: 100,
    })
    expect(dto.calibration.find((b) => b.band === 'LOW')).toMatchObject({
      tickets: 1,
      accuracy: 0,
    })
  })

  it('tolerates a record without applied, model, at or tags', async () => {
    const row = createFakeSdAiComparisonTicket({
      aiTriage: {
        suggestions: { category: { id: 'cat1', name: 'Rede' } },
      } as never,
    })
    repo.listTriaged.mockResolvedValue(ok([row]))
    const dto = expectOk(
      await SdAiComparisonService.overview('u1', WS, QUERY, NOW),
    )
    expect(dto.summary).toMatchObject({ settled: 1, accuracy: 100 })
    expect(dto.summary.avgConfidence).toBe(0)
  })

  it('measures what the agent kept of replies and solutions', async () => {
    const solved = createFakeSdAiComparisonTicket({
      id: 't1',
      solution: 'Reinicie o cliente VPN e tente novamente',
    })
    const openTicket = createFakeSdAiComparisonTicket({
      id: 't2',
      phaseCategory: 'IN_PROGRESS',
    })
    repo.listSuggestions.mockResolvedValue(
      ok([
        createFakeSdAiSuggestion({
          id: 's-reply-edited',
          ticketId: 't1',
          createdAt: new Date(NOW.getTime() - 72 * HOUR),
        }),
        createFakeSdAiSuggestion({
          id: 's-reply-other-user',
          ticketId: 't1',
          userId: 'u2',
          createdAt: new Date(NOW.getTime() - 72 * HOUR),
        }),
        createFakeSdAiSuggestion({
          id: 's-reply-pending',
          ticketId: 't2',
          createdAt: new Date(NOW.getTime() - HOUR),
        }),
        createFakeSdAiSuggestion({
          id: 's-solution-adopted',
          ticketId: 't1',
          kind: 'SOLUTION',
          text: 'Reinicie o cliente VPN e tente novamente',
        }),
        createFakeSdAiSuggestion({
          id: 's-solution-open',
          ticketId: 't2',
          kind: 'SOLUTION',
        }),
        createFakeSdAiSuggestion({
          id: 's-orphan',
          ticketId: 'deleted',
        }),
        createFakeSdAiSuggestion({
          id: 's-no-user',
          ticketId: 't1',
          userId: null,
        }),
        createFakeSdAiSuggestion({
          id: 's-unknown-kind',
          ticketId: 't1',
          kind: 'MYSTERY',
        }),
      ]),
    )
    repo.listTicketsByIds.mockResolvedValue(ok([solved, openTicket]))
    repo.listAgentMessages.mockResolvedValue(
      ok([
        {
          ticketId: 't1',
          authorUserId: 'u1',
          body: '<p>Antes da sugestão, nada a ver</p>',
          createdAt: new Date(NOW.getTime() - 100 * HOUR),
        },
        {
          ticketId: 't1',
          authorUserId: 'u1',
          body: '<p>Reinicie o cliente VPN, limpe o cache e confirme o acesso</p>',
          createdAt: new Date(NOW.getTime() - 70 * HOUR),
        },
        {
          ticketId: 't9',
          authorUserId: 'u1',
          body: 'outro chamado',
          createdAt: new Date(NOW.getTime() - 70 * HOUR),
        },
      ]),
    )
    repo.userNames.mockResolvedValue(ok([{ id: 'u1', name: 'Ana' }]))
    repo.usageByFeature.mockResolvedValue(
      ok([
        { feature: 'SERVICEDESK_COPILOT', calls: 6, costUsd: 0.03 },
        { feature: 'SERVICEDESK_TRIAGE', calls: 4, costUsd: 0.01 },
      ]),
    )

    const dto = expectOk(
      await SdAiComparisonService.overview('u1', WS, QUERY, NOW),
    )
    const [reply, solution] = dto.texts
    expect(reply).toMatchObject({
      kind: 'REPLY',
      total: 3,
      adopted: 0,
      edited: 1,
      notUsed: 1,
      pending: 1,
      usageRate: 50,
    })
    expect(solution).toMatchObject({
      kind: 'SOLUTION',
      total: 2,
      adopted: 1,
      pending: 1,
      usageRate: 100,
    })
    expect(repo.listTicketsByIds).toHaveBeenCalledWith(
      WS,
      expect.arrayContaining(['t1', 't2', 'deleted']),
    )
    expect(repo.listAgentMessages).toHaveBeenCalledWith(WS, [
      't1',
      't2',
      'deleted',
    ])
    expect(dto.agents).toEqual([
      { userId: 'u1', name: 'Ana', suggestions: 4, used: 2, usageRate: 100 },
      {
        userId: 'u2',
        name: 'Agente removido',
        suggestions: 1,
        used: 0,
        usageRate: 0,
      },
    ])
    expect(dto.usage.calls).toBe(10)
    expect(dto.usage.costUsd).toBeCloseTo(0.04)
    expect(dto.usage.costPerUsedUsd).toBeCloseTo(0.02)
  })

  it('compares copilot classification suggestions with the final ticket', async () => {
    const ticket = createFakeSdAiComparisonTicket({
      id: 't1',
      aiTriage: null,
      department: { id: 'd1', name: 'Suporte' },
    })
    const open = createFakeSdAiComparisonTicket({
      id: 't2',
      aiTriage: null,
      phaseCategory: 'WAITING',
    })
    repo.listSuggestions.mockResolvedValue(
      ok([
        createFakeSdAiSuggestion({
          ticketId: 't1',
          kind: 'CLASSIFICATION',
          text: null,
          payload: createFakeSdAiClassification({
            department: { id: 'd1', name: 'Suporte' },
          }) as never,
        }),
        createFakeSdAiSuggestion({
          ticketId: 't1',
          userId: 'u2',
          kind: 'CLASSIFICATION',
          text: null,
          payload: createFakeSdAiClassification({
            category: { id: 'zzz', name: 'Outro' },
            department: { id: 'dx', name: 'Financeiro' },
          }) as never,
        }),
        createFakeSdAiSuggestion({
          ticketId: 't1',
          kind: 'CLASSIFICATION',
          text: null,
          payload: null,
        }),
        createFakeSdAiSuggestion({
          ticketId: 't1',
          kind: 'CLASSIFICATION',
          text: null,
          payload: createFakeSdAiClassification({ category: null }) as never,
        }),
        createFakeSdAiSuggestion({
          ticketId: 't2',
          kind: 'CLASSIFICATION',
          text: null,
          payload: createFakeSdAiClassification() as never,
        }),
      ]),
    )
    repo.listTicketsByIds.mockResolvedValue(ok([ticket, open]))
    repo.userNames.mockResolvedValue(
      ok([
        { id: 'u1', name: 'Ana' },
        { id: 'u2', name: 'Beto' },
      ]),
    )

    const dto = expectOk(
      await SdAiComparisonService.overview('u1', WS, QUERY, NOW),
    )
    expect(dto.fields.find((f) => f.field === 'category')).toMatchObject({
      compared: 2,
      matched: 1,
    })
    expect(dto.fields.find((f) => f.field === 'department')).toMatchObject({
      compared: 2,
      matched: 1,
    })
    expect(dto.agents.map((a) => [a.name, a.suggestions, a.used])).toEqual([
      ['Ana', 4, 1],
      ['Beto', 1, 0],
    ])
    expect(dto.divergences.map((d) => d.appliedByAi)).toEqual([false, false])
  })

  it('caps divergences at the 20 most recent', async () => {
    const rows = Array.from({ length: 25 }, (_, i) =>
      triaged(
        `t${i}`,
        { number: i + 1, category: { id: 'x', name: 'Outro' } },
        createFakeSdAiTriageRecord({
          at: new Date(NOW.getTime() - i * HOUR).toISOString(),
        }),
      ),
    )
    repo.listTriaged.mockResolvedValue(ok(rows))
    const dto = expectOk(
      await SdAiComparisonService.overview('u1', WS, QUERY, NOW),
    )
    expect(dto.divergences).toHaveLength(20)
    expect(dto.divergences[0]?.ticketId).toBe('t0')
  })

  it('computes the pre-service deflection over finished conversations', async () => {
    repo.preServiceOutcomes.mockResolvedValue(
      ok([
        { outcome: 'resolved_by_kb', total: 6 },
        { outcome: 'ticket_opened', total: 3 },
        { outcome: 'abandoned', total: 1 },
        { outcome: null, total: 2 },
      ]),
    )
    const dto = expectOk(
      await SdAiComparisonService.overview('u1', WS, QUERY, NOW),
    )
    expect(dto.preService).toEqual({
      conversations: 12,
      resolvedByKb: 6,
      ticketOpened: 3,
      abandoned: 1,
      open: 2,
      deflectionRate: 60,
    })
  })

  it('defaults to the current time', async () => {
    const dto = expectOk(await SdAiComparisonService.overview('u1', WS, QUERY))
    expect(Math.abs(new Date(dto.to).getTime() - Date.now())).toBeLessThan(5000)
  })

  it('refuses requesters and non-members', async () => {
    actAs('requester')
    expectErr(
      await SdAiComparisonService.overview('u1', WS, QUERY, NOW),
      'SD_NOT_AGENT',
    )
    actAs('non-member')
    expectErr(
      await SdAiComparisonService.overview('u1', WS, QUERY, NOW),
      'FORBIDDEN',
    )
    expect(repo.listTriaged).not.toHaveBeenCalled()
  })

  it('propagates config and repository failures', async () => {
    engine.loadConfig.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SdAiComparisonService.overview('u1', WS, QUERY, NOW),
      'DATABASE_ERROR',
    )

    const failures: Array<() => void> = [
      () => repo.listTriaged.mockResolvedValue(err(databaseError())),
      () => repo.listSuggestions.mockResolvedValue(err(databaseError())),
      () => repo.usageByFeature.mockResolvedValue(err(databaseError())),
      () => repo.preServiceOutcomes.mockResolvedValue(err(databaseError())),
      () => repo.listTicketsByIds.mockResolvedValue(err(databaseError())),
      () => repo.listAgentMessages.mockResolvedValue(err(databaseError())),
      () => repo.userNames.mockResolvedValue(err(databaseError())),
    ]
    for (const fail of failures) {
      repo.listTriaged.mockResolvedValue(ok([]))
      repo.listSuggestions.mockResolvedValue(ok([]))
      repo.usageByFeature.mockResolvedValue(ok([]))
      repo.preServiceOutcomes.mockResolvedValue(ok([]))
      repo.listTicketsByIds.mockResolvedValue(ok([]))
      repo.listAgentMessages.mockResolvedValue(ok([]))
      repo.userNames.mockResolvedValue(ok([]))
      fail()
      expectErr(
        await SdAiComparisonService.overview('u1', WS, QUERY, NOW),
        'DATABASE_ERROR',
      )
    }
  })
})
