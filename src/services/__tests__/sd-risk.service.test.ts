import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeSdIncidentCluster,
  createFakeSdRiskPrediction,
} from '@/src/__tests__/factories/sd-risk.factory'
import { createFakeSdTicket } from '@/src/__tests__/factories/sd-ticket.factory'
import { createFakeSdSettings } from '@/src/__tests__/factories/sd-ticket-context.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { actAs } from '@/src/__tests__/helpers/sd-config.helpers'
import { databaseError, sdTicketNotFound } from '@/src/errors'
import { err, ok } from '@/src/lib/result'
import { DEFAULT_SD_TICKET_PREFIXES } from '@/src/lib/servicedesk/ticket-code'
import {
  ListSdIncidentClustersSchema,
  ListSdRiskTicketsSchema,
  OpenSdClusterProblemSchema,
} from '@/src/schemas/sd-risk.schema'

vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/sd-access.repository')
vi.mock('@/src/repositories/sd-risk.repository')
vi.mock('@/src/repositories/sd-ticket.repository', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/src/repositories/sd-ticket.repository')
  >()),
  SdTicketRepository: { listOpenForSla: vi.fn(), findById: vi.fn() },
}))
vi.mock('@/src/repositories/sd-ticket-context.repository')
vi.mock('../sd-ticket-engine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../sd-ticket-engine')>()),
  SdTicketEngine: {
    loadConfig: vi.fn(),
    resolveRef: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}))
vi.mock('../sd-notification.service', () => ({ notifySdEvent: vi.fn() }))
vi.mock('../sd-automation-engine', () => ({ runSdAutomations: vi.fn() }))

import { auditMutation } from '@/lib/axiom/audit'
import { SdRiskRepository } from '@/src/repositories/sd-risk.repository'
import { SdTicketRepository } from '@/src/repositories/sd-ticket.repository'
import { SdTicketContextRepository } from '@/src/repositories/sd-ticket-context.repository'
import { runSdAutomations } from '../sd-automation-engine'
import { notifySdEvent } from '../sd-notification.service'
import { SdRiskService } from '../sd-risk.service'
import { SdTicketEngine } from '../sd-ticket-engine'

const repo = vi.mocked(SdRiskRepository)
const tickets = vi.mocked(SdTicketRepository)
const context = vi.mocked(SdTicketContextRepository)
const engine = vi.mocked(SdTicketEngine)
const notify = vi.mocked(notifySdEvent)
const automations = vi.mocked(runSdAutomations)
const audit = vi.mocked(auditMutation)

const NOW = new Date('2026-10-02T12:00:00.000Z')
const HOUR = 60 * 60 * 1000
const CONFIG = {
  settings: createFakeSdSettings(),
  prefixes: DEFAULT_SD_TICKET_PREFIXES,
}

/** Chamado aberto, atrasado, sem responsável: cai em risco alto. */
function riskyTicket(overrides = {}) {
  return createFakeSdTicket({
    id: 't1',
    workspaceId: 'ws1',
    number: 1,
    assigneeId: null,
    createdAt: new Date(NOW.getTime() - 72 * HOUR),
    resolutionDueAt: new Date(NOW.getTime() - 2 * HOUR),
    lastActivityAt: new Date(NOW.getTime() - 60 * HOUR),
    reopenCount: 2,
    priority: { id: 'p1', name: 'P1 – Crítica', level: 4, color: '#ef4444' },
    ...overrides,
  })
}

/** Chamado recém-aberto com responsável: faixa baixa. */
function calmTicket(overrides = {}) {
  return createFakeSdTicket({
    id: 't2',
    workspaceId: 'ws1',
    number: 2,
    assigneeId: 'u1',
    createdAt: NOW,
    lastActivityAt: NOW,
    ...overrides,
  })
}

/** Agrupamento com id estável (as mutações recebem o id do grupo). */
function cluster(
  overrides: Partial<Parameters<typeof createFakeSdIncidentCluster>[0]> = {},
) {
  return createFakeSdIncidentCluster({ id: 'c1', ...overrides })
}

function ticketRef(overrides = {}) {
  return {
    id: 't1',
    number: 1,
    type: 'INCIDENT' as const,
    title: 'Servidor de e-mail fora do ar',
    createdAt: NOW,
    phase: {
      name: 'Novo',
      color: null,
      category: 'NEW' as const,
    },
    priority: null,
    ...overrides,
  }
}

beforeEach(() => {
  actAs('agent')
  engine.loadConfig.mockResolvedValue(ok(CONFIG))
  context.listEnabledWorkspaceIds.mockResolvedValue(ok(['ws1']))
  tickets.listOpenForSla.mockResolvedValue(ok([]))
  tickets.findById.mockResolvedValue(ok(riskyTicket()))
  repo.openCountsByDepartment.mockResolvedValue(ok({}))
  repo.openCountsByAssignee.mockResolvedValue(ok({}))
  repo.maxScaleLevels.mockResolvedValue(ok({ priority: 4, severity: 3 }))
  repo.breachHistory.mockResolvedValue(ok({ customerIds: [], serviceIds: [] }))
  repo.levelsByTicketIds.mockResolvedValue(ok(new Map()))
  repo.lastTeamActivityByTicketIds.mockResolvedValue(ok(new Map()))
  repo.upsertPrediction.mockResolvedValue(ok(createFakeSdRiskPrediction()))
  repo.deleteClosedPredictions.mockResolvedValue(ok(0))
  repo.listRanked.mockResolvedValue(ok([]))
  repo.findByTicket.mockResolvedValue(ok(createFakeSdRiskPrediction()))
  repo.listRecentIncidents.mockResolvedValue(ok([]))
  repo.findClusterBySignature.mockResolvedValue(ok(null))
  repo.upsertCluster.mockResolvedValue(ok(cluster()))
  repo.deleteStaleClusters.mockResolvedValue(ok(0))
  repo.listClusters.mockResolvedValue(ok([cluster()]))
  repo.findCluster.mockResolvedValue(ok(cluster()))
  repo.listTicketRefs.mockResolvedValue(ok([]))
  repo.setClusterProblem.mockResolvedValue(
    ok(cluster({ problemTicketId: 'prb' })),
  )
  repo.dismissCluster.mockResolvedValue(
    ok(cluster({ dismissedAt: NOW, dismissedById: 'u1' })),
  )
  notify.mockResolvedValue(
    ok({
      event: 'sla.breach_predicted',
      recipients: 1,
      inApp: 1,
      email: 0,
      whatsapp: 0,
      skipped: null,
    }),
  )
  automations.mockResolvedValue(ok({ matched: 0, rules: [] }))
  engine.create.mockResolvedValue(
    ok(createFakeSdTicket({ id: 'prb', number: 7, type: 'PROBLEM' })),
  )
  engine.update.mockResolvedValue(ok(createFakeSdTicket({ id: 't1' })))
  engine.resolveRef.mockResolvedValue(ok(riskyTicket()))
})

/* ------------------------------------------------------------------ */
/* recomputeTick                                                        */
/* ------------------------------------------------------------------ */

describe('SdRiskService.recomputeTick', () => {
  it('grava uma previsão por chamado aberto e conta as faixas', async () => {
    tickets.listOpenForSla.mockResolvedValue(ok([riskyTicket(), calmTicket()]))

    const result = expectOk(await SdRiskService.recomputeTick({}, NOW))

    expect(result).toMatchObject({
      workspaces: 1,
      tickets: 2,
      high: 1,
      low: 1,
      errors: 0,
    })
    expect(repo.upsertPrediction).toHaveBeenCalledTimes(2)
    const [, ticketId, data] = repo.upsertPrediction.mock.calls[0]
    expect(ticketId).toBe('t1')
    expect(data.level).toBe('HIGH')
    expect(data.computedAt).toBe(NOW)
    // Toda previsão gravada leva o porquê.
    expect(data.factors).not.toEqual([])
  })

  it('varre só o workspace pedido quando ele vem no job', async () => {
    const result = expectOk(
      await SdRiskService.recomputeTick({ workspaceId: 'ws9' }, NOW),
    )

    expect(context.listEnabledWorkspaceIds).not.toHaveBeenCalled()
    expect(result.workspaces).toBe(1)
    expect(engine.loadConfig).toHaveBeenCalledWith('ws9')
  })

  it('avisa quando o chamado ENTRA na faixa alta', async () => {
    tickets.listOpenForSla.mockResolvedValue(ok([riskyTicket()]))

    const result = expectOk(await SdRiskService.recomputeTick({}, NOW))

    expect(result.notified).toBe(1)
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'sla.breach_predicted',
        workspaceId: 'ws1',
        ticket: expect.objectContaining({ code: 'INC-000001' }),
      }),
    )
    const payload = notify.mock.calls[0][0].payload
    expect(payload.title).toContain('INC-000001')
    // O aviso leva o motivo, não só a nota.
    expect(payload.body.length).toBeGreaterThan(10)
  })

  it('não avisa de novo quem já estava na faixa alta', async () => {
    tickets.listOpenForSla.mockResolvedValue(ok([riskyTicket()]))
    repo.levelsByTicketIds.mockResolvedValue(ok(new Map([['t1', 'HIGH']])))

    const result = expectOk(await SdRiskService.recomputeTick({}, NOW))

    expect(result.high).toBe(1)
    expect(result.notified).toBe(0)
    expect(notify).not.toHaveBeenCalled()
  })

  it('avisa quem subiu de faixa', async () => {
    tickets.listOpenForSla.mockResolvedValue(ok([riskyTicket()]))
    repo.levelsByTicketIds.mockResolvedValue(ok(new Map([['t1', 'MEDIUM']])))

    expect(expectOk(await SdRiskService.recomputeTick({}, NOW)).notified).toBe(
      1,
    )
  })

  it('segue em frente quando a notificação falha', async () => {
    tickets.listOpenForSla.mockResolvedValue(ok([riskyTicket()]))
    notify.mockResolvedValue(err(databaseError()))

    expect(expectOk(await SdRiskService.recomputeTick({}, NOW)).notified).toBe(
      1,
    )
  })

  it('usa as médias do workspace como régua da pressão de fila', async () => {
    tickets.listOpenForSla.mockResolvedValue(
      ok([calmTicket({ departmentId: 'd1' })]),
    )
    repo.openCountsByDepartment.mockResolvedValue(ok({ d1: 20, d2: 10, d3: 0 }))

    expectOk(await SdRiskService.recomputeTick({}, NOW))

    const data = repo.upsertPrediction.mock.calls[0][2]
    expect(
      (data.factors as { key: string }[]).some(
        (f) => f.key === 'queue_pressure',
      ),
    ).toBe(true)
  })

  it('mede o silêncio pelos eventos da equipe, não pela mensagem do cliente', async () => {
    // O cliente escreveu agora (lastActivityAt = NOW), mas a equipe está
    // calada há 30 h: o fator "sem interação" tem de pegar.
    tickets.listOpenForSla.mockResolvedValue(ok([calmTicket()]))
    repo.lastTeamActivityByTicketIds.mockResolvedValue(
      ok(new Map([['t2', new Date(NOW.getTime() - 30 * HOUR)]])),
    )

    expectOk(await SdRiskService.recomputeTick({}, NOW))

    expect(repo.lastTeamActivityByTicketIds).toHaveBeenCalledWith('ws1', ['t2'])
    const factors = repo.upsertPrediction.mock.calls[0][2].factors as {
      key: string
      detail: string
    }[]
    expect(factors.find((f) => f.key === 'stale')?.detail).toBe(
      'Sem interação da equipe há 1 d',
    )
  })

  it('conta o silêncio desde a abertura quando a equipe nunca agiu', async () => {
    tickets.listOpenForSla.mockResolvedValue(
      ok([calmTicket({ createdAt: new Date(NOW.getTime() - 50 * HOUR) })]),
    )

    expectOk(await SdRiskService.recomputeTick({}, NOW))

    const factors = repo.upsertPrediction.mock.calls[0][2].factors as {
      key: string
      weight: number
    }[]
    expect(factors.find((f) => f.key === 'stale')?.weight).toBe(12)
  })

  it('cai na última atividade do chamado quando os eventos não carregam', async () => {
    tickets.listOpenForSla.mockResolvedValue(
      ok([calmTicket({ createdAt: new Date(NOW.getTime() - 50 * HOUR) })]),
    )
    repo.lastTeamActivityByTicketIds.mockResolvedValue(err(databaseError()))

    const result = expectOk(await SdRiskService.recomputeTick({}, NOW))

    expect(result.errors).toBe(1)
    const factors = repo.upsertPrediction.mock.calls[0][2].factors as {
      key: string
    }[]
    // lastActivityAt = NOW: sem o fator, como antes.
    expect(factors.some((f) => f.key === 'stale')).toBe(false)
  })

  it('pagina os chamados abertos', async () => {
    const batch = Array.from({ length: 200 }, (_, i) =>
      calmTicket({ id: `t${i}`, number: i + 1 }),
    )
    tickets.listOpenForSla
      .mockResolvedValueOnce(ok(batch))
      .mockResolvedValueOnce(ok([calmTicket({ id: 'last' })]))

    const result = expectOk(await SdRiskService.recomputeTick({}, NOW))

    expect(result.tickets).toBe(201)
    expect(tickets.listOpenForSla).toHaveBeenLastCalledWith('ws1', 't199', 200)
  })

  it('apaga as previsões dos chamados encerrados', async () => {
    repo.deleteClosedPredictions.mockResolvedValue(ok(3))

    expect(expectOk(await SdRiskService.recomputeTick({}, NOW)).removed).toBe(3)
  })

  it('devolve erro quando nem a lista de workspaces carrega', async () => {
    context.listEnabledWorkspaceIds.mockResolvedValue(err(databaseError()))

    expectErr(await SdRiskService.recomputeTick({}, NOW), 'DATABASE_ERROR')
  })

  it('conta erro e segue quando a configuração ou os dados falham', async () => {
    engine.loadConfig.mockResolvedValue(err(databaseError()))

    expect(expectOk(await SdRiskService.recomputeTick({}, NOW)).errors).toBe(1)
  })

  it('conta erro de estatística, de lote, de gravação e de limpeza', async () => {
    repo.openCountsByDepartment.mockResolvedValue(err(databaseError()))
    repo.openCountsByAssignee.mockResolvedValue(err(databaseError()))
    repo.maxScaleLevels.mockResolvedValue(err(databaseError()))
    repo.breachHistory.mockResolvedValue(err(databaseError()))
    repo.levelsByTicketIds.mockResolvedValue(err(databaseError()))
    repo.lastTeamActivityByTicketIds.mockResolvedValue(err(databaseError()))
    repo.upsertPrediction.mockResolvedValue(err(databaseError()))
    repo.deleteClosedPredictions.mockResolvedValue(err(databaseError()))
    tickets.listOpenForSla.mockResolvedValue(ok([riskyTicket()]))

    const result = expectOk(await SdRiskService.recomputeTick({}, NOW))

    // 4 estatísticas + faixas anteriores + atividade da equipe + gravação
    // + limpeza.
    expect(result.errors).toBe(8)
    expect(result.high).toBe(0)
  })

  it('conta erro quando o lote de chamados falha', async () => {
    tickets.listOpenForSla.mockResolvedValue(err(databaseError()))

    expect(expectOk(await SdRiskService.recomputeTick({}, NOW)).errors).toBe(1)
  })

  it('isola uma exceção inesperada de um workspace', async () => {
    context.listEnabledWorkspaceIds.mockResolvedValue(ok(['ws1', 'ws2']))
    engine.loadConfig
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(ok(CONFIG))

    const result = expectOk(await SdRiskService.recomputeTick({}, NOW))

    expect(result.workspaces).toBe(2)
    expect(result.errors).toBe(1)
  })
})

/* ------------------------------------------------------------------ */
/* scanClusters                                                         */
/* ------------------------------------------------------------------ */

const INCIDENTS = [
  {
    id: 'a',
    title: 'Servidor de e-mail fora do ar',
    categoryId: 'cat',
    subcategoryId: null,
    serviceId: null,
    createdAt: new Date(NOW.getTime() - 3 * 24 * HOUR),
  },
  {
    id: 'b',
    title: 'E-mail fora do ar no servidor',
    categoryId: 'cat',
    subcategoryId: null,
    serviceId: null,
    createdAt: new Date(NOW.getTime() - 2 * 24 * HOUR),
  },
  {
    id: 'c',
    title: 'Servidor de e-mail fora',
    categoryId: 'cat',
    subcategoryId: null,
    serviceId: null,
    createdAt: NOW,
  },
]

describe('SdRiskService.scanClusters', () => {
  it('grava o grupo e avisa os líderes na primeira detecção', async () => {
    repo.listRecentIncidents.mockResolvedValue(ok(INCIDENTS))

    const result = expectOk(await SdRiskService.scanClusters({}, NOW))

    expect(result).toMatchObject({
      workspaces: 1,
      incidents: 3,
      clusters: 1,
      created: 1,
      reopened: 0,
      errors: 0,
    })
    expect(repo.upsertCluster).toHaveBeenCalledWith(
      'ws1',
      'cat:-:-:fora-mail-servidor',
      expect.objectContaining({ ticketCount: 3, ticketIds: ['a', 'b', 'c'] }),
      false,
    )
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'problem.cluster_detected' }),
    )
  })

  it('não avisa de novo um grupo que já existia', async () => {
    repo.listRecentIncidents.mockResolvedValue(ok(INCIDENTS))
    repo.findClusterBySignature.mockResolvedValue(ok(cluster()))

    const result = expectOk(await SdRiskService.scanClusters({}, NOW))

    expect(result.created).toBe(0)
    expect(notify).not.toHaveBeenCalled()
    expect(repo.upsertCluster).toHaveBeenCalled()
  })

  it('respeita o descarte enquanto não houver repetição nova o bastante', async () => {
    repo.listRecentIncidents.mockResolvedValue(ok(INCIDENTS))
    repo.findClusterBySignature.mockResolvedValue(
      ok(
        cluster({
          dismissedAt: new Date(NOW.getTime() - 24 * HOUR),
        }),
      ),
    )

    const result = expectOk(await SdRiskService.scanClusters({}, NOW))

    expect(repo.upsertCluster).not.toHaveBeenCalled()
    expect(result.reopened).toBe(0)
    expect(notify).not.toHaveBeenCalled()
    // A assinatura segue protegida da limpeza.
    expect(repo.deleteStaleClusters).toHaveBeenCalledWith('ws1', [
      'cat:-:-:fora-mail-servidor',
    ])
  })

  it('ressuscita o grupo descartado quando os incidentes voltam', async () => {
    repo.listRecentIncidents.mockResolvedValue(ok(INCIDENTS))
    repo.findClusterBySignature.mockResolvedValue(
      ok(
        cluster({
          dismissedAt: new Date(NOW.getTime() - 10 * 24 * HOUR),
        }),
      ),
    )

    const result = expectOk(await SdRiskService.scanClusters({}, NOW))

    expect(result.reopened).toBe(1)
    expect(repo.upsertCluster).toHaveBeenCalledWith(
      'ws1',
      expect.any(String),
      expect.any(Object),
      true,
    )
    expect(notify).toHaveBeenCalled()
  })

  it('ignora incidentes abaixo do corte e limpa as sugestões vencidas', async () => {
    repo.listRecentIncidents.mockResolvedValue(ok(INCIDENTS.slice(0, 2)))
    repo.deleteStaleClusters.mockResolvedValue(ok(2))

    const result = expectOk(await SdRiskService.scanClusters({}, NOW))

    expect(result.clusters).toBe(0)
    expect(result.removed).toBe(2)
    expect(repo.upsertCluster).not.toHaveBeenCalled()
  })

  it('usa a janela de observação na consulta', async () => {
    await SdRiskService.scanClusters({ workspaceId: 'ws1' }, NOW)

    const since = repo.listRecentIncidents.mock.calls[0][1]
    expect(NOW.getTime() - since.getTime()).toBe(7 * 24 * HOUR)
  })

  it('silencia quando o chamado representante não carrega', async () => {
    repo.listRecentIncidents.mockResolvedValue(ok(INCIDENTS))
    tickets.findById.mockResolvedValue(err(sdTicketNotFound()))

    expect(expectOk(await SdRiskService.scanClusters({}, NOW)).created).toBe(1)
    expect(notify).not.toHaveBeenCalled()
  })

  it('registra falha de notificação sem derrubar o tick', async () => {
    repo.listRecentIncidents.mockResolvedValue(ok(INCIDENTS))
    notify.mockResolvedValue(err(databaseError()))

    expect(expectOk(await SdRiskService.scanClusters({}, NOW)).created).toBe(1)
  })

  it('conta os erros de banco e devolve erro só se os workspaces falharem', async () => {
    repo.listRecentIncidents.mockResolvedValue(err(databaseError()))
    expect(expectOk(await SdRiskService.scanClusters({}, NOW)).errors).toBe(1)

    engine.loadConfig.mockResolvedValue(err(databaseError()))
    expect(expectOk(await SdRiskService.scanClusters({}, NOW)).errors).toBe(1)

    context.listEnabledWorkspaceIds.mockResolvedValue(err(databaseError()))
    expectErr(await SdRiskService.scanClusters({}, NOW), 'DATABASE_ERROR')
  })

  it('conta erro de busca e de gravação do grupo, e de limpeza', async () => {
    repo.listRecentIncidents.mockResolvedValue(ok(INCIDENTS))
    repo.findClusterBySignature.mockResolvedValue(err(databaseError()))
    repo.deleteStaleClusters.mockResolvedValue(err(databaseError()))

    expect(expectOk(await SdRiskService.scanClusters({}, NOW)).errors).toBe(2)

    repo.findClusterBySignature.mockResolvedValue(ok(null))
    repo.upsertCluster.mockResolvedValue(err(databaseError()))

    expect(expectOk(await SdRiskService.scanClusters({}, NOW)).errors).toBe(2)
  })

  it('isola uma exceção inesperada do workspace', async () => {
    repo.listRecentIncidents.mockRejectedValue(new Error('boom'))

    expect(expectOk(await SdRiskService.scanClusters({}, NOW)).errors).toBe(1)
  })
})

/* ------------------------------------------------------------------ */
/* Leitura                                                              */
/* ------------------------------------------------------------------ */

const LIST = ListSdRiskTicketsSchema.parse({})
const CLUSTERS = ListSdIncidentClustersSchema.parse({})

describe('SdRiskService.listTickets', () => {
  it('devolve os chamados da faixa com a previsão dentro', async () => {
    repo.listRanked.mockResolvedValue(
      ok([
        {
          ...createFakeSdRiskPrediction(),
          ticket: riskyTicket({
            riskPrediction: createFakeSdRiskPrediction(),
          }),
        },
      ]),
    )

    const out = expectOk(
      await SdRiskService.listTickets('u1', 'ws1', { ...LIST, limit: 10 }),
    )

    expect(out).toHaveLength(1)
    expect(out[0].code).toBe('INC-000001')
    expect(out[0].risk).toMatchObject({ level: 'HIGH', score: 74 })
    expect(out[0].risk?.factors[0].detail.length).toBeGreaterThan(0)
    expect(repo.listRanked).toHaveBeenCalledWith('ws1', {
      level: 'HIGH',
      minScore: undefined,
      departmentId: undefined,
      assigneeId: undefined,
      limit: 10,
    })
  })

  it('recusa solicitante e não-membro', async () => {
    actAs('requester')
    expectErr(
      await SdRiskService.listTickets('r1', 'ws1', LIST),
      'SD_NOT_AGENT',
    )

    actAs('stranger')
    expectErr(await SdRiskService.listTickets('x', 'ws1', LIST), 'FORBIDDEN')
  })

  it('recusa quando o módulo está desabilitado', async () => {
    actAs('disabled')
    expectErr(
      await SdRiskService.listTickets('u1', 'ws1', LIST),
      'MODULE_DISABLED',
    )
  })

  it('propaga o erro do banco', async () => {
    repo.listRanked.mockResolvedValue(err(databaseError()))
    expectErr(await SdRiskService.listTickets('u1', 'ws1', LIST))
  })

  it('propaga a falha de configuração', async () => {
    engine.loadConfig.mockResolvedValue(err(databaseError()))
    expectErr(await SdRiskService.listTickets('u1', 'ws1', LIST))
  })
})

describe('SdRiskService.getTicketRisk', () => {
  it('devolve a previsão do chamado com os fatores', async () => {
    const dto = expectOk(await SdRiskService.getTicketRisk('u1', 'ws1', '1'))

    expect(dto).toMatchObject({ level: 'HIGH', score: 74 })
    expect(dto.factors).toHaveLength(1)
  })

  it('responde SD_RISK_PREDICTION_NOT_FOUND sem previsão calculada', async () => {
    repo.findByTicket.mockResolvedValue(ok(null))

    expectErr(
      await SdRiskService.getTicketRisk('u1', 'ws1', '1'),
      'SD_RISK_PREDICTION_NOT_FOUND',
    )
  })

  it('propaga chamado inexistente e erro do banco', async () => {
    engine.resolveRef.mockResolvedValue(err(sdTicketNotFound()))
    expectErr(
      await SdRiskService.getTicketRisk('u1', 'ws1', 'nope'),
      'SD_TICKET_NOT_FOUND',
    )

    engine.resolveRef.mockResolvedValue(ok(riskyTicket()))
    repo.findByTicket.mockResolvedValue(err(databaseError()))
    expectErr(await SdRiskService.getTicketRisk('u1', 'ws1', '1'))
  })

  it('recusa agente sem visibilidade sobre o chamado', async () => {
    // Admin sem departamento é agente; aqui o ator perde a visibilidade.
    actAs('requester')
    expectErr(
      await SdRiskService.getTicketRisk('r1', 'ws1', '1'),
      'SD_NOT_AGENT',
    )
  })
})

describe('SdRiskService.listClusters', () => {
  it('devolve as sugestões com os incidentes do grupo', async () => {
    repo.listClusters.mockResolvedValue(ok([cluster({ ticketIds: ['t1'] })]))
    repo.listTicketRefs.mockResolvedValue(ok([ticketRef()]))

    const out = expectOk(
      await SdRiskService.listClusters('u1', 'ws1', CLUSTERS),
    )

    expect(out).toHaveLength(1)
    expect(out[0].tickets[0].code).toBe('INC-000001')
    expect(repo.listClusters).toHaveBeenCalledWith('ws1', 'open', 30)
  })

  it('pede o problema vinculado junto dos incidentes', async () => {
    repo.listClusters.mockResolvedValue(
      ok([
        cluster({
          ticketIds: ['t1'],
          problemTicketId: 'prb',
        }),
      ]),
    )

    expectOk(await SdRiskService.listClusters('u1', 'ws1', CLUSTERS))

    expect(repo.listTicketRefs).toHaveBeenCalledWith('ws1', ['t1', 'prb'])
  })

  it('recusa solicitante e propaga erros', async () => {
    actAs('requester')
    expectErr(
      await SdRiskService.listClusters('r1', 'ws1', CLUSTERS),
      'SD_NOT_AGENT',
    )

    actAs('agent')
    repo.listClusters.mockResolvedValue(err(databaseError()))
    expectErr(await SdRiskService.listClusters('u1', 'ws1', CLUSTERS))

    repo.listClusters.mockResolvedValue(ok([cluster()]))
    repo.listTicketRefs.mockResolvedValue(err(databaseError()))
    expectErr(await SdRiskService.listClusters('u1', 'ws1', CLUSTERS))
  })
})

/* ------------------------------------------------------------------ */
/* Ações do agente                                                      */
/* ------------------------------------------------------------------ */

const OPEN = OpenSdClusterProblemSchema.parse({})

describe('SdRiskService.openProblem', () => {
  it('abre o problema pelo motor, vincula os incidentes e audita', async () => {
    repo.findCluster.mockResolvedValue(ok(cluster({ ticketIds: ['t1', 't2'] })))
    repo.listTicketRefs.mockResolvedValue(
      ok([ticketRef(), ticketRef({ id: 't2', number: 2 })]),
    )

    const out = expectOk(
      await SdRiskService.openProblem('u1', 'ws1', 'c1', OPEN),
    )

    const [workspaceId, input] = engine.create.mock.calls[0]
    expect(workspaceId).toBe('ws1')
    expect(input).toMatchObject({
      type: 'PROBLEM',
      title: 'Servidor de e-mail fora do ar',
      channel: 'AGENT',
    })
    expect(input.description).toContain('INC-000001')
    expect(engine.update).toHaveBeenCalledTimes(2)
    expect(engine.update.mock.calls[0][1]).toEqual({ parentId: 'prb' })
    expect(repo.setClusterProblem).toHaveBeenCalledWith('c1', 'prb')
    expect(automations).toHaveBeenCalledWith('TICKET_CREATED', 'prb', {
      actorId: 'u1',
    })
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'sd_ticket',
        action: 'create',
        targetId: 'prb',
        meta: expect.objectContaining({ linked: 2, from: 'incident_cluster' }),
      }),
    )
    expect(out.problemTicket).toBeNull()
  })

  it('usa o título e o destino informados pelo agente', async () => {
    await SdRiskService.openProblem(
      'u1',
      'ws1',
      'c1',
      OpenSdClusterProblemSchema.parse({
        title: 'Causa raiz do e-mail',
        departmentId: 'd1',
        assigneeId: 'u2',
        priorityId: 'p1',
        categoryId: 'cat1',
      }),
    )

    expect(engine.create.mock.calls[0][1]).toMatchObject({
      title: 'Causa raiz do e-mail',
      departmentId: 'd1',
      assigneeId: 'u2',
      priorityId: 'p1',
      categoryId: 'cat1',
    })
  })

  it('não vincula quando o agente pede para não vincular', async () => {
    repo.findCluster.mockResolvedValue(ok(cluster({ ticketIds: ['t1'] })))

    await SdRiskService.openProblem(
      'u1',
      'ws1',
      'c1',
      OpenSdClusterProblemSchema.parse({ linkIncidents: false }),
    )

    expect(engine.update).not.toHaveBeenCalled()
  })

  it('pula o incidente que já tem pai e o que não carrega', async () => {
    repo.findCluster.mockResolvedValue(
      ok(cluster({ ticketIds: ['t1', 't2', 't3'] })),
    )
    tickets.findById
      .mockResolvedValueOnce(ok(riskyTicket({ parentId: 'outro' })))
      .mockResolvedValueOnce(err(sdTicketNotFound()))
      .mockResolvedValueOnce(ok(riskyTicket({ id: 't3' })))
    engine.update.mockResolvedValue(err(databaseError()))

    expectOk(await SdRiskService.openProblem('u1', 'ws1', 'c1', OPEN))

    expect(engine.update).toHaveBeenCalledTimes(1)
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ meta: expect.objectContaining({ linked: 0 }) }),
    )
  })

  it('recusa um agrupamento inexistente, já tratado ou descartado', async () => {
    repo.findCluster.mockResolvedValue(ok(null))
    expectErr(
      await SdRiskService.openProblem('u1', 'ws1', 'c1', OPEN),
      'SD_INCIDENT_CLUSTER_NOT_FOUND',
    )

    repo.findCluster.mockResolvedValue(ok(cluster({ problemTicketId: 'prb' })))
    expectErr(
      await SdRiskService.openProblem('u1', 'ws1', 'c1', OPEN),
      'SD_INCIDENT_CLUSTER_CLOSED',
    )

    repo.findCluster.mockResolvedValue(ok(cluster({ dismissedAt: NOW })))
    expectErr(
      await SdRiskService.openProblem('u1', 'ws1', 'c1', OPEN),
      'SD_INCIDENT_CLUSTER_CLOSED',
    )
  })

  it('recusa solicitante e não-membro', async () => {
    actAs('requester')
    expectErr(
      await SdRiskService.openProblem('r1', 'ws1', 'c1', OPEN),
      'SD_NOT_AGENT',
    )

    actAs('stranger')
    expectErr(
      await SdRiskService.openProblem('x', 'ws1', 'c1', OPEN),
      'FORBIDDEN',
    )
  })

  it('audita a falha do motor e propaga o erro', async () => {
    engine.create.mockResolvedValue(err(databaseError()))

    expectErr(await SdRiskService.openProblem('u1', 'ws1', 'c1', OPEN))
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failure' }),
    )
    expect(repo.setClusterProblem).not.toHaveBeenCalled()
  })

  it('propaga erro de banco ao ler o grupo ou ao vincular', async () => {
    repo.findCluster.mockResolvedValue(err(databaseError()))
    expectErr(await SdRiskService.openProblem('u1', 'ws1', 'c1', OPEN))

    repo.findCluster.mockResolvedValue(ok(cluster()))
    repo.listTicketRefs.mockResolvedValue(err(databaseError()))
    expectErr(await SdRiskService.openProblem('u1', 'ws1', 'c1', OPEN))

    repo.listTicketRefs.mockResolvedValue(ok([]))
    repo.setClusterProblem.mockResolvedValue(err(databaseError()))
    expectErr(await SdRiskService.openProblem('u1', 'ws1', 'c1', OPEN))
  })
})

describe('SdRiskService.dismissCluster', () => {
  it('descarta a sugestão e audita', async () => {
    const out = expectOk(
      await SdRiskService.dismissCluster('u1', 'ws1', 'c1', NOW),
    )

    expect(repo.dismissCluster).toHaveBeenCalledWith('c1', 'u1', NOW)
    expect(out.dismissedAt).toBe(NOW.toISOString())
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'sd_incident_cluster',
        action: 'update',
        targetId: 'c1',
      }),
    )
  })

  it('recusa um grupo inexistente, já tratado ou já descartado', async () => {
    repo.findCluster.mockResolvedValue(ok(null))
    expectErr(
      await SdRiskService.dismissCluster('u1', 'ws1', 'c1', NOW),
      'SD_INCIDENT_CLUSTER_NOT_FOUND',
    )

    repo.findCluster.mockResolvedValue(ok(cluster({ problemTicketId: 'prb' })))
    expectErr(
      await SdRiskService.dismissCluster('u1', 'ws1', 'c1', NOW),
      'SD_INCIDENT_CLUSTER_CLOSED',
    )

    repo.findCluster.mockResolvedValue(ok(cluster({ dismissedAt: NOW })))
    expectErr(
      await SdRiskService.dismissCluster('u1', 'ws1', 'c1', NOW),
      'SD_INCIDENT_CLUSTER_CLOSED',
    )
  })

  it('recusa solicitante e propaga o erro do banco', async () => {
    actAs('requester')
    expectErr(
      await SdRiskService.dismissCluster('r1', 'ws1', 'c1', NOW),
      'SD_NOT_AGENT',
    )

    actAs('agent')
    repo.dismissCluster.mockResolvedValue(err(databaseError()))
    expectErr(await SdRiskService.dismissCluster('u1', 'ws1', 'c1', NOW))
  })
})
