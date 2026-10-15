import { describe, expect, it, vi } from 'vitest'
import {
  seedCrmPipeline,
  seedCrmPipelineStage,
} from '@/src/__tests__/factories/crm-pipeline.factory'
import { seedMembership } from '@/src/__tests__/factories/membership.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { CrmSalesMetricsRepository as repo } from '../crm-sales-metrics.repository'

const FROM = new Date('2026-10-01T03:00:00.000Z')
const TO = new Date('2026-11-01T03:00:00.000Z')
const IN_OCTOBER = new Date('2026-10-15T15:00:00.000Z')

async function world() {
  const [workspace, other, owner] = await Promise.all([
    seedWorkspace(),
    seedWorkspace(),
    seedUser({ name: 'Ana Souza' }),
  ])
  await seedMembership({ userId: owner.id, workspaceId: workspace.id })
  const pipeline = await seedCrmPipeline(workspace.id, owner.id, {
    name: 'Vendas',
    isDefault: true,
  })
  const [open, proposal, wonStage, lost] = await Promise.all([
    seedCrmPipelineStage(pipeline.id, {
      name: 'Qualificação',
      probability: 20,
      position: 0,
    }),
    seedCrmPipelineStage(pipeline.id, {
      name: 'Proposta',
      probability: 60,
      position: 1,
    }),
    seedCrmPipelineStage(pipeline.id, {
      name: 'Ganho',
      category: 'WON',
      probability: 100,
      position: 2,
    }),
    seedCrmPipelineStage(pipeline.id, {
      name: 'Perdido',
      category: 'LOST',
      position: 3,
    }),
  ])
  const company = await prisma.crmCompany.create({
    data: { name: 'ACME', workspaceId: workspace.id, createdById: owner.id },
  })
  return {
    workspace,
    other,
    owner,
    pipeline,
    open,
    proposal,
    wonStage,
    lost,
    company,
  }
}

function deal(
  w: Awaited<ReturnType<typeof world>>,
  data: Partial<{
    name: string
    amount: number
    stageId: string
    wonAt: Date | null
    deletedAt: Date | null
    ownerId: string | null
    createdAt: Date
    closeDate: Date
    updatedAt: Date
    workspaceId: string
    pipelineId: string
  }>,
) {
  return prisma.crmOpportunity.create({
    data: {
      name: 'Negócio',
      workspaceId: w.workspace.id,
      createdById: w.owner.id,
      pipelineId: w.pipeline.id,
      stageId: w.open.id,
      ownerId: w.owner.id,
      companyId: w.company.id,
      ...data,
    },
  })
}

describe('CrmSalesMetricsRepository', () => {
  it('lists wins by wonAt that still sit in a WON stage', async () => {
    const w = await world()
    await deal(w, {
      name: 'Ganho',
      amount: 1000,
      stageId: w.wonStage.id,
      wonAt: IN_OCTOBER,
    })
    await deal(w, { name: 'Reaberto', stageId: w.open.id, wonAt: IN_OCTOBER })
    await deal(w, {
      name: 'Setembro',
      stageId: w.wonStage.id,
      wonAt: new Date('2026-09-30T12:00:00.000Z'),
    })
    await deal(w, {
      name: 'Excluído',
      stageId: w.wonStage.id,
      wonAt: IN_OCTOBER,
      deletedAt: new Date(),
    })

    const rows = expectOk(await repo.listWonBetween(w.workspace.id, FROM, TO))
    expect(rows.map((row) => row.name)).toEqual(['Ganho'])
    expect(rows[0]).toMatchObject({
      owner: { id: w.owner.id, name: 'Ana Souza', image: null },
      company: { name: 'ACME' },
    })
    expect(Number(rows[0].amount)).toBe(1000)

    const otherPipeline = expectOk(
      await repo.listWonBetween(w.workspace.id, FROM, TO, {
        pipelineId: 'nope',
        limit: 1,
      }),
    )
    expect(otherPipeline).toEqual([])
    expectOk(await repo.listWonBetween(w.other.id, FROM, TO)).forEach(() => {
      throw new Error('leaked across workspaces')
    })
  })

  it('lists open deals of live pipelines with stage and owner', async () => {
    const w = await world()
    await deal(w, { name: 'Aberta', stageId: w.proposal.id, amount: 500 })
    await deal(w, { name: 'Perdida', stageId: w.lost.id })
    const deadPipeline = await seedCrmPipeline(w.workspace.id, w.owner.id, {
      deletedAt: new Date(),
    })
    const deadStage = await seedCrmPipelineStage(deadPipeline.id)
    await deal(w, {
      name: 'Pipeline excluído',
      pipelineId: deadPipeline.id,
      stageId: deadStage.id,
    })

    const rows = expectOk(await repo.listOpen(w.workspace.id))
    expect(rows.map((row) => row.name)).toEqual(['Aberta'])
    expect(rows[0].stage).toMatchObject({ name: 'Proposta', probability: 60 })
    expect(expectOk(await repo.listOpen(w.workspace.id, 'other'))).toEqual([])
  })

  it('reads the latest activity per deal', async () => {
    const w = await world()
    const a = await deal(w, {})
    const older = new Date('2026-10-01T12:00:00.000Z')
    const newer = new Date('2026-10-10T12:00:00.000Z')
    await prisma.crmActivity.createMany({
      data: [older, newer].map((createdAt) => ({
        workspaceId: w.workspace.id,
        action: 'UPDATED',
        entity: 'opportunity',
        entityId: a.id,
        opportunityId: a.id,
        createdAt,
      })),
    })
    const map = expectOk(
      await repo.lastActivityByOpportunity(w.workspace.id, [a.id, 'none']),
    )
    expect(map.get(a.id)?.toISOString()).toBe(newer.toISOString())
    expect(map.has('none')).toBe(false)
    expect(
      expectOk(await repo.lastActivityByOpportunity(w.workspace.id, [])).size,
    ).toBe(0)
  })

  it('lists the quotas of a period with their owner', async () => {
    const w = await world()
    await prisma.crmQuota.create({
      data: {
        workspaceId: w.workspace.id,
        ownerId: w.owner.id,
        createdById: w.owner.id,
        period: 'MONTH',
        periodKey: '2026-10',
        targetAmount: 50_000,
      },
    })
    const rows = expectOk(
      await repo.listQuotas(w.workspace.id, 'MONTH', '2026-10'),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].owner.name).toBe('Ana Souza')
    expect(
      expectOk(await repo.listQuotas(w.workspace.id, 'QUARTER', '2026-Q4')),
    ).toEqual([])
  })

  it('counts the lead and deal funnels of a window', async () => {
    const w = await world()
    const lead = (data: Record<string, unknown>) =>
      prisma.crmLead.create({
        data: {
          name: 'Lead',
          workspaceId: w.workspace.id,
          createdById: w.owner.id,
          createdAt: IN_OCTOBER,
          ...data,
        },
      })
    await lead({})
    await lead({ stage: 'OPPORTUNITY' })
    await lead({ stage: 'CLOSED', closeResult: 'WON' })
    await lead({ stage: 'CLOSED', closeResult: 'LOST' })
    await lead({ stage: 'PROPOSAL', deletedAt: new Date() })
    await lead({ createdAt: new Date('2026-09-01T12:00:00.000Z') })

    expect(
      expectOk(await repo.countLeadFunnel(w.workspace.id, FROM, TO)),
    ).toEqual({
      total: 4,
      converted: 2,
    })

    await deal(w, { createdAt: IN_OCTOBER })
    await deal(w, { createdAt: IN_OCTOBER, stageId: w.wonStage.id })
    await deal(w, {
      createdAt: new Date('2026-09-01T12:00:00.000Z'),
      stageId: w.wonStage.id,
    })
    expect(
      expectOk(await repo.countDealFunnel(w.workspace.id, FROM, TO)),
    ).toEqual({
      total: 2,
      won: 1,
    })
  })

  it('lists proposals waiting for the customer, earliest validity first', async () => {
    const w = await world()
    const opp = await deal(w, { amount: 7000 })
    const proposal = (name: string, data: Record<string, unknown>) =>
      prisma.crmProposal.create({
        data: {
          name,
          workspaceId: w.workspace.id,
          createdById: w.owner.id,
          responsibleId: w.owner.id,
          shareToken: `t-${name}`,
          ...data,
        },
      })
    await proposal('sem-validade', { status: 'SENT' })
    await proposal('vista', {
      status: 'VIEWED',
      validUntil: new Date('2026-10-20T02:59:59.999Z'),
      opportunityId: opp.id,
      companyId: w.company.id,
    })
    await proposal('rascunho', { status: 'DRAFT' })
    await proposal('aceita', { status: 'ACCEPTED' })

    const rows = expectOk(await repo.listWaitingProposals(w.workspace.id))
    expect(rows.map((row) => row.name)).toEqual(['vista', 'sem-validade'])
    expect(rows[0]).toMatchObject({
      company: { name: 'ACME' },
      responsible: { name: 'Ana Souza' },
    })
    expect(Number(rows[0].opportunity?.amount)).toBe(7000)
  })

  it('counts the activity of a day', async () => {
    const w = await world()
    const lead = await prisma.crmLead.create({
      data: {
        name: 'Lead',
        workspaceId: w.workspace.id,
        createdById: w.owner.id,
      },
    })
    await prisma.crmCalendarEvent.create({
      data: {
        workspaceId: w.workspace.id,
        createdById: w.owner.id,
        title: 'Reunião',
        startsAt: IN_OCTOBER,
        endsAt: IN_OCTOBER,
      },
    })
    await prisma.crmLeadMeeting.create({
      data: {
        leadId: lead.id,
        workspaceId: w.workspace.id,
        scheduledAt: IN_OCTOBER,
        format: 'ONLINE',
        interestDetails: 'x',
        identifiedNeed: 'y',
        createdById: w.owner.id,
      },
    })
    await prisma.crmTask.create({
      data: {
        title: 'Aberta',
        status: 'TODO',
        updatedAt: IN_OCTOBER,
        workspaceId: w.workspace.id,
        createdById: w.owner.id,
      },
    })
    await prisma.crmTask.create({
      data: {
        title: 'Ligar',
        status: 'DONE',
        updatedAt: IN_OCTOBER,
        workspaceId: w.workspace.id,
        createdById: w.owner.id,
      },
    })
    await prisma.crmLeadContactAttempt.create({
      data: {
        leadId: lead.id,
        workspaceId: w.workspace.id,
        contactedWith: 'Ana',
        channel: 'PHONE',
        occurredAt: IN_OCTOBER,
        createdById: w.owner.id,
      },
    })
    const today = expectOk(
      await repo.countDayActivity(
        w.workspace.id,
        new Date('2026-10-15T03:00:00.000Z'),
        new Date('2026-10-16T03:00:00.000Z'),
      ),
    )
    expect(today).toEqual({ meetings: 2, tasksDone: 1, contactAttempts: 1 })
    const yesterday = expectOk(
      await repo.countDayActivity(
        w.workspace.id,
        new Date('2026-10-14T03:00:00.000Z'),
        new Date('2026-10-15T03:00:00.000Z'),
      ),
    )
    expect(yesterday).toEqual({ meetings: 0, tasksDone: 0, contactAttempts: 0 })
  })

  it('groups new leads by source and channel', async () => {
    const w = await world()
    await prisma.crmLead.createMany({
      data: [
        {
          name: 'a',
          source: 'Site',
          workspaceId: w.workspace.id,
          createdById: w.owner.id,
          createdAt: IN_OCTOBER,
        },
        {
          name: 'b',
          source: 'Site',
          workspaceId: w.workspace.id,
          createdById: w.owner.id,
          createdAt: IN_OCTOBER,
        },
        {
          name: 'c',
          channel: 'WhatsApp',
          workspaceId: w.workspace.id,
          createdById: w.owner.id,
          createdAt: IN_OCTOBER,
        },
      ],
    })
    const groups = expectOk(
      await repo.groupLeadsBySource(w.workspace.id, FROM, TO),
    )
    expect(groups).toEqual(
      expect.arrayContaining([
        { source: 'Site', channel: null, count: 2 },
        { source: null, channel: 'WhatsApp', count: 1 },
      ]),
    )
  })

  it('finds the asked pipeline or falls back to the default one', async () => {
    const w = await world()
    const second = await seedCrmPipeline(w.workspace.id, w.owner.id, {
      name: 'Parcerias',
      position: 2,
    })
    expect(
      expectOk(await repo.findPipeline(w.workspace.id, second.id)),
    ).toEqual({
      id: second.id,
      name: 'Parcerias',
    })
    expect(
      expectOk(await repo.findPipeline(w.workspace.id, 'gone'))?.name,
    ).toBe('Vendas')
    expect(expectOk(await repo.findPipeline(w.workspace.id))?.id).toBe(
      w.pipeline.id,
    )
    expect(expectOk(await repo.findPipeline(w.other.id))).toBeNull()
  })

  it('lists stages, pipelines and members for the lookups', async () => {
    const w = await world()
    const stages = expectOk(await repo.listStages(w.workspace.id))
    expect(stages.map((stage) => stage.name)).toEqual([
      'Qualificação',
      'Proposta',
      'Ganho',
      'Perdido',
    ])
    expect(expectOk(await repo.listStages(w.workspace.id, 'other'))).toEqual([])
    expect(expectOk(await repo.listPipelines(w.workspace.id))).toEqual([
      { id: w.pipeline.id, name: 'Vendas' },
    ])
    expect(expectOk(await repo.listMembers(w.workspace.id))).toEqual([
      { id: w.owner.id, name: 'Ana Souza', image: null },
    ])
  })

  it('reads the default business calendar', async () => {
    const w = await world()
    expect(expectOk(await repo.findClock(w.workspace.id))).toBeNull()
    await prisma.sdBusinessCalendar.create({
      data: {
        workspaceId: w.workspace.id,
        name: 'Padrão',
        timezone: 'America/Manaus',
        schedule: {},
        holidays: [{ date: '2026-10-12' }],
        isDefault: true,
      },
    })
    expect(expectOk(await repo.findClock(w.workspace.id))).toEqual({
      timezone: 'America/Manaus',
      holidays: [{ date: '2026-10-12' }],
    })
  })

  it('returns DATABASE_ERROR when Prisma fails', async () => {
    const boom = () => new Error('boom')
    vi.spyOn(prisma.crmOpportunity, 'findMany').mockRejectedValueOnce(boom())
    expectErr(await repo.listWonBetween('ws', FROM, TO), 'DATABASE_ERROR')
    vi.spyOn(prisma.crmOpportunity, 'findMany').mockRejectedValueOnce(boom())
    expectErr(await repo.listOpen('ws'), 'DATABASE_ERROR')
    vi.spyOn(prisma.crmActivity, 'groupBy').mockRejectedValueOnce(boom())
    expectErr(
      await repo.lastActivityByOpportunity('ws', ['x']),
      'DATABASE_ERROR',
    )
    vi.spyOn(prisma.crmQuota, 'findMany').mockRejectedValueOnce(boom())
    expectErr(await repo.listQuotas('ws', 'MONTH', '2026-10'), 'DATABASE_ERROR')
    vi.spyOn(prisma.crmLead, 'count').mockRejectedValueOnce(boom())
    expectErr(await repo.countLeadFunnel('ws', FROM, TO), 'DATABASE_ERROR')
    vi.spyOn(prisma.crmOpportunity, 'count').mockRejectedValueOnce(boom())
    expectErr(await repo.countDealFunnel('ws', FROM, TO), 'DATABASE_ERROR')
    vi.spyOn(prisma.crmProposal, 'findMany').mockRejectedValueOnce(boom())
    expectErr(await repo.listWaitingProposals('ws'), 'DATABASE_ERROR')
    vi.spyOn(prisma.crmTask, 'count').mockRejectedValueOnce(boom())
    expectErr(await repo.countDayActivity('ws', FROM, TO), 'DATABASE_ERROR')
    vi.spyOn(prisma.crmLead, 'groupBy').mockRejectedValueOnce(boom())
    expectErr(await repo.groupLeadsBySource('ws', FROM, TO), 'DATABASE_ERROR')
    vi.spyOn(prisma.crmPipeline, 'findFirst').mockRejectedValueOnce(boom())
    expectErr(await repo.findPipeline('ws'), 'DATABASE_ERROR')
    vi.spyOn(prisma.crmPipelineStage, 'findMany').mockRejectedValueOnce(boom())
    expectErr(await repo.listStages('ws'), 'DATABASE_ERROR')
    vi.spyOn(prisma.crmPipeline, 'findMany').mockRejectedValueOnce(boom())
    expectErr(await repo.listPipelines('ws'), 'DATABASE_ERROR')
    vi.spyOn(prisma.membership, 'findMany').mockRejectedValueOnce(boom())
    expectErr(await repo.listMembers('ws'), 'DATABASE_ERROR')
    vi.spyOn(prisma.sdBusinessCalendar, 'findFirst').mockRejectedValueOnce(
      boom(),
    )
    expectErr(await repo.findClock('ws'), 'DATABASE_ERROR')
  })
})
