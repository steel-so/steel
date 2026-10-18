import { describe, expect, it, vi } from 'vitest'
import { seedSdIncidentCluster } from '@/src/__tests__/factories/sd-risk.factory'
import { seedSdTicket } from '@/src/__tests__/factories/sd-ticket.factory'
import {
  seedSdCategory,
  seedSdDepartment,
  seedSdPhaseFlow,
  seedSdPriority,
  seedSdSettings,
  seedSdSeverity,
} from '@/src/__tests__/factories/sd-ticket-context.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { SdRiskRepository } from '../sd-risk.repository'

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date('2026-10-02T12:00:00.000Z')

async function setup() {
  const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
  // `sd_settings` é único por workspace e o seed do chamado o cria sob
  // demanda: criar antes evita a corrida entre os chamados em paralelo.
  await seedSdSettings(workspace.id)
  const flow = await seedSdPhaseFlow(workspace.id)
  const department = await seedSdDepartment(workspace.id)
  return { workspace, user, flow, department }
}

function prediction(score: number, level: 'LOW' | 'MEDIUM' | 'HIGH') {
  return {
    level,
    score,
    factors: [
      {
        key: 'sla_consumed',
        label: 'Prazo já consumido',
        weight: score,
        detail: 'prazo estourando',
      },
    ],
    breachEtaAt: new Date(NOW.getTime() + 3600_000),
    computedAt: NOW,
  }
}

describe('SdRiskRepository — previsões', () => {
  it('grava uma linha por chamado e sobrescreve no recálculo', async () => {
    const { workspace, flow } = await setup()
    const ticket = await seedSdTicket(workspace.id, flow.initial.id)

    const first = expectOk(
      await SdRiskRepository.upsertPrediction(
        workspace.id,
        ticket.id,
        prediction(45, 'MEDIUM'),
      ),
    )
    expect(first.level).toBe('MEDIUM')

    const second = expectOk(
      await SdRiskRepository.upsertPrediction(
        workspace.id,
        ticket.id,
        prediction(80, 'HIGH'),
      ),
    )
    expect(second.id).toBe(first.id)
    expect(second.score).toBe(80)
    expect(await prisma.sdTicketRiskPrediction.count()).toBe(1)
  })

  it('devolve a faixa anterior de cada chamado (e nada sem ids)', async () => {
    const { workspace, flow } = await setup()
    const [a, b] = await Promise.all([
      seedSdTicket(workspace.id, flow.initial.id),
      seedSdTicket(workspace.id, flow.initial.id),
    ])
    await SdRiskRepository.upsertPrediction(
      workspace.id,
      a.id,
      prediction(80, 'HIGH'),
    )

    const levels = expectOk(
      await SdRiskRepository.levelsByTicketIds(workspace.id, [a.id, b.id]),
    )
    expect(levels.get(a.id)).toBe('HIGH')
    expect(levels.has(b.id)).toBe(false)

    const empty = expectOk(
      await SdRiskRepository.levelsByTicketIds(workspace.id, []),
    )
    expect(empty.size).toBe(0)
  })

  it('lê a previsão de um chamado e isola o workspace', async () => {
    const { workspace, flow } = await setup()
    const other = await seedWorkspace()
    const ticket = await seedSdTicket(workspace.id, flow.initial.id)
    await SdRiskRepository.upsertPrediction(
      workspace.id,
      ticket.id,
      prediction(80, 'HIGH'),
    )

    expect(
      expectOk(await SdRiskRepository.findByTicket(workspace.id, ticket.id))
        ?.score,
    ).toBe(80)
    expect(
      expectOk(await SdRiskRepository.findByTicket(other.id, ticket.id)),
    ).toBeNull()
  })

  it('ordena a fila pela nota e filtra faixa, nota, time e responsável', async () => {
    const { workspace, user, flow, department } = await setup()
    const [low, mid, top, otherDept] = await Promise.all([
      seedSdTicket(workspace.id, flow.initial.id, { title: 'Baixo' }),
      seedSdTicket(workspace.id, flow.initial.id, {
        title: 'Alto 72',
        departmentId: department.id,
      }),
      seedSdTicket(workspace.id, flow.initial.id, {
        title: 'Alto 90',
        departmentId: department.id,
        assigneeId: user.id,
      }),
      seedSdTicket(workspace.id, flow.initial.id, { title: 'Alto sem time' }),
    ])
    await SdRiskRepository.upsertPrediction(
      workspace.id,
      low.id,
      prediction(10, 'LOW'),
    )
    await SdRiskRepository.upsertPrediction(
      workspace.id,
      mid.id,
      prediction(72, 'HIGH'),
    )
    await SdRiskRepository.upsertPrediction(
      workspace.id,
      top.id,
      prediction(90, 'HIGH'),
    )
    await SdRiskRepository.upsertPrediction(
      workspace.id,
      otherDept.id,
      prediction(75, 'HIGH'),
    )

    const high = expectOk(
      await SdRiskRepository.listRanked(workspace.id, {
        level: 'HIGH',
        limit: 10,
      }),
    )
    expect(high.map((r) => r.score)).toEqual([90, 75, 72])
    expect(high[0].ticket.title).toBe('Alto 90')

    const scoped = expectOk(
      await SdRiskRepository.listRanked(workspace.id, {
        level: 'HIGH',
        minScore: 80,
        departmentId: department.id,
        limit: 10,
      }),
    )
    expect(scoped.map((r) => r.ticket.id)).toEqual([top.id])

    const mine = expectOk(
      await SdRiskRepository.listRanked(workspace.id, {
        level: 'HIGH',
        assigneeId: user.id,
        limit: 10,
      }),
    )
    expect(mine).toHaveLength(1)
  })

  it('tira da fila o chamado que foi encerrado', async () => {
    const { workspace, flow } = await setup()
    const ticket = await seedSdTicket(workspace.id, flow.initial.id)
    await SdRiskRepository.upsertPrediction(
      workspace.id,
      ticket.id,
      prediction(90, 'HIGH'),
    )
    await prisma.sdTicket.update({
      where: { id: ticket.id },
      data: { phaseId: flow.closed.id },
    })

    const rows = expectOk(
      await SdRiskRepository.listRanked(workspace.id, {
        level: 'HIGH',
        limit: 10,
      }),
    )
    expect(rows).toEqual([])
  })

  it('apaga as previsões de chamados fechados e excluídos', async () => {
    const { workspace, flow } = await setup()
    const [open, closed, deleted] = await Promise.all([
      seedSdTicket(workspace.id, flow.initial.id),
      seedSdTicket(workspace.id, flow.closed.id),
      seedSdTicket(workspace.id, flow.initial.id, { deletedAt: NOW }),
    ])
    for (const ticket of [open, closed, deleted]) {
      await SdRiskRepository.upsertPrediction(
        workspace.id,
        ticket.id,
        prediction(50, 'MEDIUM'),
      )
    }

    expect(
      expectOk(await SdRiskRepository.deleteClosedPredictions(workspace.id)),
    ).toBe(2)
    const left = await prisma.sdTicketRiskPrediction.findMany()
    expect(left.map((row) => row.ticketId)).toEqual([open.id])
  })
})

describe('SdRiskRepository — estatísticas do workspace', () => {
  it('conta os chamados abertos por time e por responsável', async () => {
    const { workspace, user, flow, department } = await setup()
    const other = await seedSdDepartment(workspace.id, { name: 'N2' })
    await Promise.all([
      seedSdTicket(workspace.id, flow.initial.id, {
        departmentId: department.id,
        assigneeId: user.id,
      }),
      seedSdTicket(workspace.id, flow.inProgress.id, {
        departmentId: department.id,
        assigneeId: user.id,
      }),
      seedSdTicket(workspace.id, flow.initial.id, { departmentId: other.id }),
      // Encerrado e sem time: fora das contas.
      seedSdTicket(workspace.id, flow.closed.id, {
        departmentId: department.id,
        assigneeId: user.id,
      }),
      seedSdTicket(workspace.id, flow.initial.id),
    ])

    const byDepartment = expectOk(
      await SdRiskRepository.openCountsByDepartment(workspace.id),
    )
    expect(byDepartment).toEqual({ [department.id]: 2, [other.id]: 1 })

    const byAssignee = expectOk(
      await SdRiskRepository.openCountsByAssignee(workspace.id),
    )
    expect(byAssignee).toEqual({ [user.id]: 2 })
  })

  it('lê o último evento de agente de cada chamado, sem contar o cliente', async () => {
    const { workspace, user, flow } = await setup()
    const other = await seedWorkspace()
    const [answered, onlyCustomer, silent] = await Promise.all([
      seedSdTicket(workspace.id, flow.initial.id),
      seedSdTicket(workspace.id, flow.initial.id),
      seedSdTicket(workspace.id, flow.initial.id),
    ])
    const event = (
      ticketId: string,
      actorKind: 'AGENT' | 'CONTACT' | 'REQUESTER' | 'SYSTEM',
      hoursAgo: number,
      workspaceId = workspace.id,
    ) => ({
      workspaceId,
      ticketId,
      actorKind,
      actorUserId: actorKind === 'AGENT' ? user.id : null,
      action: 'message.posted',
      createdAt: new Date(NOW.getTime() - hoursAgo * 3600_000),
    })
    await prisma.sdTicketEvent.createMany({
      data: [
        event(answered.id, 'AGENT', 30),
        event(answered.id, 'AGENT', 10),
        // Mais recente que o agente, mas é o cliente: não conta.
        event(answered.id, 'CONTACT', 1),
        event(onlyCustomer.id, 'REQUESTER', 2),
        event(onlyCustomer.id, 'SYSTEM', 3),
      ],
    })

    const activity = expectOk(
      await SdRiskRepository.lastTeamActivityByTicketIds(workspace.id, [
        answered.id,
        onlyCustomer.id,
        silent.id,
      ]),
    )
    expect(activity.get(answered.id)?.toISOString()).toBe(
      new Date(NOW.getTime() - 10 * 3600_000).toISOString(),
    )
    expect(activity.has(onlyCustomer.id)).toBe(false)
    expect(activity.has(silent.id)).toBe(false)

    // Outro workspace não enxerga os eventos, e lista vazia não consulta.
    expect(
      expectOk(
        await SdRiskRepository.lastTeamActivityByTicketIds(other.id, [
          answered.id,
        ]),
      ).size,
    ).toBe(0)
    expect(
      expectOk(await SdRiskRepository.lastTeamActivityByTicketIds(other.id, []))
        .size,
    ).toBe(0)
  })

  it('lê o topo das escalas (zero quando não há escala)', async () => {
    const { workspace } = await setup()
    expect(
      expectOk(await SdRiskRepository.maxScaleLevels(workspace.id)),
    ).toEqual({ priority: 0, severity: 0 })

    await seedSdPriority(workspace.id, { level: 1 })
    await seedSdPriority(workspace.id, { level: 4 })
    await seedSdSeverity(workspace.id, 3)

    expect(
      expectOk(await SdRiskRepository.maxScaleLevels(workspace.id)),
    ).toEqual({ priority: 4, severity: 3 })
  })

  it('junta os clientes, as empresas e os serviços que já violaram prazo', async () => {
    const { workspace, user, flow } = await setup()
    const category = await seedSdCategory(workspace.id)
    const service = await seedSdCategory(workspace.id, {
      level: 'SERVICE',
      name: 'E-mail',
      parentId: category.id,
    })
    const customer = await prisma.sdCustomer.create({
      data: {
        workspaceId: workspace.id,
        name: 'Stratus',
        createdById: user.id,
      },
    })
    const company = await prisma.sdCustomer.create({
      data: { workspaceId: workspace.id, name: 'Outra', createdById: user.id },
    })
    await Promise.all([
      seedSdTicket(workspace.id, flow.closed.id, {
        customerId: customer.id,
        serviceId: service.id,
        resolutionBreached: true,
      }),
      seedSdTicket(workspace.id, flow.initial.id, {
        companyId: company.id,
        firstResponseBreached: true,
      }),
      // Sem violação: não entra no histórico.
      seedSdTicket(workspace.id, flow.initial.id, { customerId: customer.id }),
    ])

    const history = expectOk(await SdRiskRepository.breachHistory(workspace.id))
    expect(history.customerIds.sort()).toEqual([customer.id, company.id].sort())
    expect(history.serviceIds).toEqual([service.id])
  })

  it('lista os incidentes da janela (sem outros tipos nem antigos)', async () => {
    const { workspace, flow } = await setup()
    const request = await seedSdPhaseFlow(workspace.id, 'SERVICE_REQUEST')
    await Promise.all([
      seedSdTicket(workspace.id, flow.initial.id, { title: 'Recente' }),
      seedSdTicket(workspace.id, flow.initial.id, {
        title: 'Antigo',
        createdAt: new Date(NOW.getTime() - 30 * DAY),
      }),
      seedSdTicket(workspace.id, request.initial.id, {
        title: 'Requisição',
        type: 'SERVICE_REQUEST',
      }),
    ])

    const rows = expectOk(
      await SdRiskRepository.listRecentIncidents(
        workspace.id,
        new Date(NOW.getTime() - 7 * DAY),
      ),
    )
    expect(rows.map((row) => row.title)).toEqual(['Recente'])
  })
})

describe('SdRiskRepository — agrupamentos', () => {
  it('cria, atualiza e ressuscita um agrupamento pela assinatura', async () => {
    const { workspace, user } = await setup()
    const signature = 'cat:sub:srv:email-fora-servidor'

    expect(
      expectOk(
        await SdRiskRepository.findClusterBySignature(workspace.id, signature),
      ),
    ).toBeNull()

    const created = expectOk(
      await SdRiskRepository.upsertCluster(workspace.id, signature, {
        title: 'Servidor de e-mail fora do ar',
        ticketIds: ['a', 'b', 'c'],
        ticketCount: 3,
        firstSeenAt: new Date(NOW.getTime() - DAY),
        lastSeenAt: NOW,
      }),
    )
    expect(created.ticketCount).toBe(3)

    await SdRiskRepository.dismissCluster(created.id, user.id, NOW)

    const reopened = expectOk(
      await SdRiskRepository.upsertCluster(
        workspace.id,
        signature,
        {
          title: 'Servidor de e-mail fora do ar',
          ticketIds: ['a', 'b', 'c', 'd'],
          ticketCount: 4,
          firstSeenAt: new Date(NOW.getTime() - DAY),
          lastSeenAt: NOW,
        },
        true,
      ),
    )
    expect(reopened.id).toBe(created.id)
    expect(reopened.ticketCount).toBe(4)
    expect(reopened.dismissedAt).toBeNull()
    expect(reopened.dismissedById).toBeNull()
  })

  it('lista por situação e isola o workspace', async () => {
    const { workspace, user } = await setup()
    const other = await seedWorkspace()
    const open = await seedSdIncidentCluster(workspace.id, { title: 'Aberto' })
    const dismissed = await seedSdIncidentCluster(workspace.id, {
      title: 'Descartado',
      dismissedAt: NOW,
      dismissedById: user.id,
    })
    const linked = await seedSdIncidentCluster(workspace.id, {
      title: 'Virou problema',
      problemTicketId: 'prb',
    })
    await seedSdIncidentCluster(other.id, { title: 'De outro workspace' })

    const live = expectOk(
      await SdRiskRepository.listClusters(workspace.id, 'open', 30),
    )
    expect(live.map((c) => c.id)).toEqual([open.id])

    const handled = expectOk(
      await SdRiskRepository.listClusters(workspace.id, 'handled', 30),
    )
    expect(handled.map((c) => c.id).sort()).toEqual(
      [dismissed.id, linked.id].sort(),
    )

    const all = expectOk(
      await SdRiskRepository.listClusters(workspace.id, 'all', 30),
    )
    expect(all).toHaveLength(3)
    expect(handled.find((c) => c.id === dismissed.id)?.dismissedBy?.id).toBe(
      user.id,
    )

    expect(
      expectOk(await SdRiskRepository.findCluster(other.id, open.id)),
    ).toBeNull()
    expect(
      expectOk(await SdRiskRepository.findCluster(workspace.id, open.id))?.id,
    ).toBe(open.id)
  })

  it('vincula o problema e registra o descarte', async () => {
    const { workspace, user } = await setup()
    const cluster = await seedSdIncidentCluster(workspace.id)

    const linked = expectOk(
      await SdRiskRepository.setClusterProblem(cluster.id, 'prb-1'),
    )
    expect(linked.problemTicketId).toBe('prb-1')

    const dismissed = expectOk(
      await SdRiskRepository.dismissCluster(cluster.id, user.id, NOW),
    )
    expect(dismissed.dismissedAt?.toISOString()).toBe(NOW.toISOString())
    expect(dismissed.dismissedBy?.id).toBe(user.id)
  })

  it('apaga só as sugestões vivas que a janela deixou de confirmar', async () => {
    const { workspace, user } = await setup()
    const keep = await seedSdIncidentCluster(workspace.id, {
      signature: 'keep',
    })
    const stale = await seedSdIncidentCluster(workspace.id, {
      signature: 'stale',
    })
    const dismissed = await seedSdIncidentCluster(workspace.id, {
      signature: 'dismissed',
      dismissedAt: NOW,
      dismissedById: user.id,
    })
    const linked = await seedSdIncidentCluster(workspace.id, {
      signature: 'linked',
      problemTicketId: 'prb',
    })

    expect(
      expectOk(
        await SdRiskRepository.deleteStaleClusters(workspace.id, ['keep']),
      ),
    ).toBe(1)
    const left = await prisma.sdIncidentCluster.findMany({
      select: { id: true },
    })
    expect(left.map((c) => c.id).sort()).toEqual(
      [keep.id, dismissed.id, linked.id].sort(),
    )
    expect(left.map((c) => c.id)).not.toContain(stale.id)
  })

  it('apaga todas as sugestões vivas quando a janela não confirma nenhuma', async () => {
    const { workspace } = await setup()
    await seedSdIncidentCluster(workspace.id, { signature: 'a' })
    await seedSdIncidentCluster(workspace.id, { signature: 'b' })

    expect(
      expectOk(await SdRiskRepository.deleteStaleClusters(workspace.id, [])),
    ).toBe(2)
  })

  it('devolve o recorte dos chamados do grupo (e nada sem ids)', async () => {
    const { workspace, flow } = await setup()
    const priority = await seedSdPriority(workspace.id, { level: 4 })
    const ticket = await seedSdTicket(workspace.id, flow.initial.id, {
      title: 'Servidor de e-mail fora do ar',
      priorityId: priority.id,
    })
    const removed = await seedSdTicket(workspace.id, flow.initial.id, {
      deletedAt: NOW,
    })

    const rows = expectOk(
      await SdRiskRepository.listTicketRefs(workspace.id, [
        ticket.id,
        removed.id,
      ]),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: ticket.id, number: ticket.number })
    expect(rows[0].priority).toMatchObject({ id: priority.id, name: 'P4' })
    expect(rows[0].phase.category).toBe('NEW')

    expect(
      expectOk(await SdRiskRepository.listTicketRefs(workspace.id, [])),
    ).toEqual([])
  })
})

describe('SdRiskRepository — falhas de banco', () => {
  it('mapeia qualquer erro do Prisma para DATABASE_ERROR', async () => {
    const boom = new Error('boom')
    vi.spyOn(prisma.sdTicketRiskPrediction, 'upsert').mockRejectedValue(boom)
    vi.spyOn(prisma.sdTicketRiskPrediction, 'findMany').mockRejectedValue(boom)
    vi.spyOn(prisma.sdTicketRiskPrediction, 'findFirst').mockRejectedValue(boom)
    vi.spyOn(prisma.sdTicketRiskPrediction, 'deleteMany').mockRejectedValue(
      boom,
    )
    vi.spyOn(prisma.sdTicket, 'groupBy').mockRejectedValue(boom)
    vi.spyOn(prisma.sdTicketEvent, 'groupBy').mockRejectedValue(boom)
    vi.spyOn(prisma.sdTicket, 'findMany').mockRejectedValue(boom)
    vi.spyOn(prisma.sdPriority, 'aggregate').mockRejectedValue(boom)
    vi.spyOn(prisma.sdIncidentCluster, 'findUnique').mockRejectedValue(boom)
    vi.spyOn(prisma.sdIncidentCluster, 'findFirst').mockRejectedValue(boom)
    vi.spyOn(prisma.sdIncidentCluster, 'findMany').mockRejectedValue(boom)
    vi.spyOn(prisma.sdIncidentCluster, 'upsert').mockRejectedValue(boom)
    vi.spyOn(prisma.sdIncidentCluster, 'update').mockRejectedValue(boom)
    vi.spyOn(prisma.sdIncidentCluster, 'deleteMany').mockRejectedValue(boom)

    const data = prediction(10, 'LOW')
    expectErr(
      await SdRiskRepository.upsertPrediction('ws', 't', data),
      'DATABASE_ERROR',
    )
    expectErr(
      await SdRiskRepository.levelsByTicketIds('ws', ['t']),
      'DATABASE_ERROR',
    )
    expectErr(await SdRiskRepository.findByTicket('ws', 't'), 'DATABASE_ERROR')
    expectErr(
      await SdRiskRepository.listRanked('ws', { level: 'HIGH', limit: 10 }),
      'DATABASE_ERROR',
    )
    expectErr(
      await SdRiskRepository.deleteClosedPredictions('ws'),
      'DATABASE_ERROR',
    )
    expectErr(
      await SdRiskRepository.openCountsByDepartment('ws'),
      'DATABASE_ERROR',
    )
    expectErr(
      await SdRiskRepository.openCountsByAssignee('ws'),
      'DATABASE_ERROR',
    )
    expectErr(await SdRiskRepository.maxScaleLevels('ws'), 'DATABASE_ERROR')
    expectErr(
      await SdRiskRepository.lastTeamActivityByTicketIds('ws', ['t']),
      'DATABASE_ERROR',
    )
    expectErr(await SdRiskRepository.breachHistory('ws'), 'DATABASE_ERROR')
    expectErr(
      await SdRiskRepository.listRecentIncidents('ws', NOW),
      'DATABASE_ERROR',
    )
    expectErr(
      await SdRiskRepository.findClusterBySignature('ws', 'sig'),
      'DATABASE_ERROR',
    )
    expectErr(
      await SdRiskRepository.upsertCluster('ws', 'sig', {
        title: 't',
        ticketIds: [],
        ticketCount: 0,
        firstSeenAt: NOW,
        lastSeenAt: NOW,
      }),
      'DATABASE_ERROR',
    )
    expectErr(
      await SdRiskRepository.deleteStaleClusters('ws', ['sig']),
      'DATABASE_ERROR',
    )
    expectErr(
      await SdRiskRepository.listClusters('ws', 'open', 10),
      'DATABASE_ERROR',
    )
    expectErr(await SdRiskRepository.findCluster('ws', 'c'), 'DATABASE_ERROR')
    expectErr(
      await SdRiskRepository.setClusterProblem('c', 'prb'),
      'DATABASE_ERROR',
    )
    expectErr(
      await SdRiskRepository.dismissCluster('c', 'u', NOW),
      'DATABASE_ERROR',
    )
    expectErr(
      await SdRiskRepository.listTicketRefs('ws', ['t']),
      'DATABASE_ERROR',
    )

    vi.restoreAllMocks()
  })
})
