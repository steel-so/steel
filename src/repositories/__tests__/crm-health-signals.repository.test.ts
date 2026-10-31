import { afterEach, describe, expect, it, vi } from 'vitest'
import { seedCrmCompany } from '@/src/__tests__/factories/crm-company.factory'
import { seedCrmOpportunity } from '@/src/__tests__/factories/crm-opportunity.factory'
import { seedCrmPerson } from '@/src/__tests__/factories/crm-person.factory'
import {
  enableModule,
  seedHealthWorkspace,
  seedZapConversation,
} from '@/src/__tests__/factories/nov-health-scores.factory'
import { seedSdTicket } from '@/src/__tests__/factories/sd-ticket.factory'
import {
  seedSdCustomer,
  seedSdPhase,
} from '@/src/__tests__/factories/sd-ticket-context.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { CrmHealthSignalsRepository as Repo } from '../crm-health-signals.repository'

afterEach(() => {
  vi.restoreAllMocks()
})

const now = new Date('2026-10-30T12:00:00Z')
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000)
const daysAhead = (n: number) => new Date(now.getTime() + n * 86_400_000)

async function company(overrides: Parameters<typeof seedCrmCompany>[2] = {}) {
  const ctx = await seedHealthWorkspace()
  const c = await seedCrmCompany(ctx.workspace.id, ctx.user.id, {
    name: 'Acme',
    cnpj: '11.222.333/0001-81',
    ...overrides,
  })
  return { ...ctx, company: c }
}

describe('customerSignals', () => {
  it('is empty for a company with no history', async () => {
    const { workspace, company: c } = await company()
    const s = expectOk(await Repo.customerSignals(workspace.id, c, now))
    expect(s.crm).toEqual({
      lastInteractionAt: null,
      openDeals: 0,
      highRiskDeals: 0,
      mediumRiskDeals: 0,
      totalDeals: 0,
      lostDeals180d: 0,
      wonDeals180d: 0,
      overdueTasks: 0,
    })
    expect(s.zap).toBeNull()
    expect(s.sd).toBeNull()
    expect(s.companyCreatedAt).toEqual(c.createdAt)
  })

  it('collects CRM interactions, deals and overdue tasks', async () => {
    const {
      workspace,
      user,
      pipeline,
      open,
      won,
      lost,
      company: c,
    } = await company()
    const person = await seedCrmPerson(workspace.id, user.id, {
      companyId: c.id,
    })
    const deal = await seedCrmOpportunity(
      workspace.id,
      user.id,
      pipeline.id,
      open.id,
      { companyId: c.id },
    )
    await seedCrmOpportunity(workspace.id, user.id, pipeline.id, won.id, {
      companyId: c.id,
    })
    const lostDeal = await seedCrmOpportunity(
      workspace.id,
      user.id,
      pipeline.id,
      lost.id,
      { companyId: c.id },
    )
    await prisma.crmOpportunity.update({
      where: { id: lostDeal.id },
      data: { updatedAt: daysAgo(10) },
    })
    await prisma.crmOpportunityHealth.create({
      data: {
        workspaceId: workspace.id,
        opportunityId: deal.id,
        riskScore: 80,
        level: 'HIGH',
        nextAction: {},
      },
    })
    await prisma.crmEmailMessage.create({
      data: {
        workspaceId: workspace.id,
        createdById: user.id,
        direction: 'INBOUND',
        fromEmail: 'a@b.com',
        personId: person.id,
        sentAt: daysAgo(20),
      },
    })
    await prisma.crmCalendarEvent.create({
      data: {
        workspaceId: workspace.id,
        createdById: user.id,
        title: 'Reunião',
        startsAt: daysAgo(5),
        endsAt: daysAgo(5),
        personId: person.id,
      },
    })
    await prisma.crmCalendarEvent.create({
      data: {
        workspaceId: workspace.id,
        createdById: user.id,
        title: 'Futura',
        startsAt: daysAhead(5),
        endsAt: daysAhead(5),
        personId: person.id,
      },
    })
    await prisma.crmNote.create({
      data: {
        workspaceId: workspace.id,
        createdById: user.id,
        companyId: c.id,
        createdAt: daysAgo(40),
      },
    })
    await prisma.crmTask.createMany({
      data: [
        {
          title: 'Atrasada',
          workspaceId: workspace.id,
          createdById: user.id,
          companyId: c.id,
          dueDate: daysAgo(2),
        },
        {
          title: 'Feita',
          workspaceId: workspace.id,
          createdById: user.id,
          companyId: c.id,
          dueDate: daysAgo(2),
          status: 'DONE',
        },
        {
          title: 'Da oportunidade',
          workspaceId: workspace.id,
          createdById: user.id,
          opportunityId: deal.id,
          dueDate: daysAgo(1),
        },
      ],
    })

    const s = expectOk(await Repo.customerSignals(workspace.id, c, now))
    expect(s.crm.lastInteractionAt).toEqual(daysAgo(5))
    expect(s.crm).toMatchObject({
      openDeals: 1,
      highRiskDeals: 1,
      mediumRiskDeals: 0,
      totalDeals: 3,
      lostDeals180d: 1,
      overdueTasks: 2,
    })
    expect(s.crm.wonDeals180d).toBe(1)
  })

  it('reads the WhatsApp sentiment of the company contacts by phone', async () => {
    const { workspace, user, company: c } = await company()
    await seedCrmPerson(workspace.id, user.id, {
      companyId: c.id,
      phones: ['(11) 99999-1234', 'sem telefone'],
    })
    await seedZapConversation(workspace.id, user.id, '5511999991234', {
      avgSentimentScore: -0.6,
      lastMessageAt: daysAgo(3),
    })
    await seedZapConversation(workspace.id, user.id, '5511999991234', {
      avgSentimentScore: 0.2,
      lastMessageAt: daysAgo(4),
    })
    await seedZapConversation(workspace.id, user.id, '5521988887777', {
      avgSentimentScore: -1,
      lastMessageAt: daysAgo(1),
    })
    await seedZapConversation(workspace.id, user.id, '5511999991234', {
      avgSentimentScore: -1,
      lastMessageAt: daysAgo(200),
    })

    const s = expectOk(await Repo.customerSignals(workspace.id, c, now))
    expect(s.zap?.conversations).toBe(2)
    expect(s.zap?.negativeConversations).toBe(1)
    expect(s.zap?.avgSentiment).toBeCloseTo(-0.2, 5)
    expect(s.crm.lastInteractionAt).toEqual(daysAgo(3))
  })

  it('has a null sentiment when the recent conversations are unscored', async () => {
    const { workspace, user, company: c } = await company()
    await seedCrmPerson(workspace.id, user.id, {
      companyId: c.id,
      phones: ['11999991234'],
    })
    await seedZapConversation(workspace.id, user.id, '11999991234', {
      avgSentimentScore: null,
      lastMessageAt: daysAgo(2),
    })
    const s = expectOk(await Repo.customerSignals(workspace.id, c, now))
    expect(s.zap).toEqual({
      conversations: 1,
      avgSentiment: null,
      negativeConversations: 0,
    })
  })

  it('matches the ServiceDesk customer by CNPJ and counts its tickets', async () => {
    const { workspace, user, company: c } = await company()
    await enableModule(workspace.id, user.id, 'SERVICE_DESK')
    const customer = await seedSdCustomer(workspace.id, user.id, {
      name: 'Outro nome',
      document: '11222333000181',
    })
    const phase = await seedSdPhase(workspace.id)
    const ticket = (overrides: Parameters<typeof seedSdTicket>[2]) =>
      seedSdTicket(workspace.id, phase.id, {
        customerId: customer.id,
        ...overrides,
      })
    const openHigh = await ticket({ createdAt: daysAgo(5) })
    await prisma.sdTicketRiskPrediction.create({
      data: {
        workspaceId: workspace.id,
        ticketId: openHigh.id,
        level: 'HIGH',
        score: 90,
      },
    })
    await ticket({
      createdAt: daysAgo(30),
      resolvedAt: daysAgo(20),
      closedAt: daysAgo(20),
      resolutionBreached: true,
      csatScore: 2,
    })
    await ticket({
      createdAt: daysAgo(100),
      resolvedAt: daysAgo(90),
      closedAt: daysAgo(90),
      firstResponseBreached: true,
      csatScore: 4,
    })
    // Older than the window and closed: ignored.
    await ticket({
      createdAt: daysAgo(300),
      resolvedAt: daysAgo(290),
      closedAt: daysAgo(290),
      resolutionBreached: true,
    })
    // Another customer's ticket: ignored.
    const stranger = await seedSdCustomer(workspace.id, user.id, {
      name: 'Estranho',
    })
    await seedSdTicket(workspace.id, phase.id, { customerId: stranger.id })

    const s = expectOk(await Repo.customerSignals(workspace.id, c, now))
    expect(s.sd).toEqual({
      openTickets: 1,
      breachedTickets90d: 1,
      tickets90d: 2,
      csatAvg: 3,
      csatCount: 2,
      highRiskOpenTickets: 1,
    })
  })

  it('matches by exact name when the company has no CNPJ, and null csat without answers', async () => {
    const { workspace, user, company: c } = await company({ cnpj: null })
    await enableModule(workspace.id, user.id, 'SERVICE_DESK')
    const customer = await seedSdCustomer(workspace.id, user.id, {
      name: 'ACME',
    })
    const phase = await seedSdPhase(workspace.id)
    await seedSdTicket(workspace.id, phase.id, { companyId: customer.id })
    const s = expectOk(await Repo.customerSignals(workspace.id, c, now))
    expect(s.sd).toMatchObject({ openTickets: 1, csatAvg: null, csatCount: 0 })
  })

  it('has no ServiceDesk signals without a matching customer or any key', async () => {
    const { workspace, user, company: c } = await company()
    await enableModule(workspace.id, user.id, 'SERVICE_DESK')
    expect(
      expectOk(await Repo.customerSignals(workspace.id, c, now)).sd,
    ).toBeNull()

    const nameless = await seedCrmCompany(workspace.id, user.id, {
      name: '  ',
      cnpj: null,
    })
    expect(
      expectOk(await Repo.customerSignals(workspace.id, nameless, now)).sd,
    ).toBeNull()
  })

  it('returns DATABASE_ERROR when a query fails', async () => {
    const { workspace, user, company: c } = await company()
    vi.spyOn(prisma.crmNote, 'aggregate').mockRejectedValueOnce(new Error('x'))
    expectErr(
      await Repo.customerSignals(workspace.id, c, now),
      'DATABASE_ERROR',
    )

    await enableModule(workspace.id, user.id, 'SERVICE_DESK')
    vi.spyOn(prisma.sdCustomer, 'findMany').mockRejectedValueOnce(
      new Error('x'),
    )
    expectErr(
      await Repo.customerSignals(workspace.id, c, now),
      'DATABASE_ERROR',
    )
  })
})

describe('opportunitySignals', () => {
  async function deal(
    overrides: Partial<Parameters<typeof seedCrmOpportunity>[4]> & {
      pointOfContactId?: string | null
    } = {},
  ) {
    const ctx = await seedHealthWorkspace()
    const { workspace, user, pipeline, open } = ctx
    const opportunity = await seedCrmOpportunity(
      workspace.id,
      user.id,
      pipeline.id,
      open.id,
      overrides,
    )
    return { ...ctx, opportunity }
  }

  it('is empty for a deal with no activity', async () => {
    const { workspace, opportunity } = await deal()
    const s = expectOk(
      await Repo.opportunitySignals(workspace.id, opportunity, now),
    )
    expect(s).toMatchObject({
      lastInteractionAt: null,
      overdueTasks: 0,
      hasNextStep: false,
      pointOfContactId: null,
      stageChangedAt: null,
      contactChangedAt: null,
    })
    expect(s.lastActivityAt).toEqual(opportunity.updatedAt)
    expect(s.createdAt).toEqual(opportunity.createdAt)
  })

  it('collects activity, interactions, tasks and next steps', async () => {
    const { workspace, user, opportunity } = await deal()
    const person = await seedCrmPerson(workspace.id, user.id, {
      phones: ['+55 11 99999-1234'],
    })
    await prisma.crmOpportunity.update({
      where: { id: opportunity.id },
      data: { pointOfContactId: person.id },
    })
    const fresh = await prisma.crmOpportunity.findUniqueOrThrow({
      where: { id: opportunity.id },
    })
    await seedZapConversation(workspace.id, user.id, '5511999991234', {
      lastMessageAt: daysAgo(2),
    })
    await prisma.crmEmailMessage.create({
      data: {
        workspaceId: workspace.id,
        createdById: user.id,
        direction: 'OUTBOUND',
        fromEmail: 'a@b.com',
        opportunityId: opportunity.id,
        sentAt: daysAgo(6),
      },
    })
    await prisma.crmCalendarEvent.create({
      data: {
        workspaceId: workspace.id,
        createdById: user.id,
        title: 'Passada',
        startsAt: daysAgo(4),
        endsAt: daysAgo(4),
        opportunityId: opportunity.id,
      },
    })
    await prisma.crmCalendarEvent.create({
      data: {
        workspaceId: workspace.id,
        createdById: user.id,
        title: 'Futura',
        startsAt: daysAhead(3),
        endsAt: daysAhead(3),
        opportunityId: opportunity.id,
      },
    })
    await prisma.crmNote.create({
      data: {
        workspaceId: workspace.id,
        createdById: user.id,
        opportunityId: opportunity.id,
        createdAt: daysAgo(1),
      },
    })
    await prisma.crmTask.create({
      data: {
        title: 'Atrasada',
        workspaceId: workspace.id,
        createdById: user.id,
        opportunityId: opportunity.id,
        dueDate: daysAgo(3),
      },
    })

    const s = expectOk(await Repo.opportunitySignals(workspace.id, fresh, now))
    expect(s.lastInteractionAt).toEqual(daysAgo(2))
    expect(s.overdueTasks).toBe(1)
    expect(s.hasNextStep).toBe(true)
    expect(s.pointOfContactId).toBe(person.id)
  })

  it('counts an undated open task as the next step', async () => {
    const { workspace, user, opportunity } = await deal()
    await prisma.crmTask.create({
      data: {
        title: 'Sem prazo',
        workspaceId: workspace.id,
        createdById: user.id,
        opportunityId: opportunity.id,
      },
    })
    const s = expectOk(
      await Repo.opportunitySignals(workspace.id, opportunity, now),
    )
    expect(s.hasNextStep).toBe(true)
    expect(s.overdueTasks).toBe(0)
  })

  it('returns DATABASE_ERROR when a query fails', async () => {
    const { workspace, opportunity } = await deal()
    vi.spyOn(prisma.crmTask, 'findMany').mockRejectedValueOnce(new Error('x'))
    expectErr(
      await Repo.opportunitySignals(workspace.id, opportunity, now),
      'DATABASE_ERROR',
    )
  })
})
