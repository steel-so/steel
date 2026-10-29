import { describe, expect, it } from 'vitest'
import { seedAiUsage } from '@/src/__tests__/factories/ai-settings.factory'
import {
  createFakeSdAiTriageRecord,
  seedSdAiSuggestion,
} from '@/src/__tests__/factories/nov-s9-ai-vs-technician.factory'
import { seedSdTicket } from '@/src/__tests__/factories/sd-ticket.factory'
import {
  seedSdCategory,
  seedSdPhase,
} from '@/src/__tests__/factories/sd-ticket-context.factory'
import { seedSdTicketMessage } from '@/src/__tests__/factories/sd-ticket-tabs.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { SdAiRepository } from '../sd-ai.repository'
import { SdAiComparisonRepository } from '../sd-ai-comparison.repository'

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date()
const WEEK_AGO = new Date(NOW.getTime() - 7 * DAY)

async function setup() {
  const [workspace, other, user] = await Promise.all([
    seedWorkspace(),
    seedWorkspace(),
    seedUser(),
  ])
  const phase = await seedSdPhase(workspace.id, {
    category: 'RESOLVED',
    name: 'Resolvido',
  })
  return { workspace, other, user, phase }
}

describe('SdAiRepository.recordSuggestion', () => {
  it('stores a reply draft and a classification payload', async () => {
    const { workspace, user, phase } = await setup()
    const ticket = await seedSdTicket(workspace.id, phase.id)

    expectOk(
      await SdAiRepository.recordSuggestion({
        workspaceId: workspace.id,
        ticketId: ticket.id,
        userId: user.id,
        kind: 'REPLY',
        text: 'Reinicie o cliente',
      }),
    )
    expectOk(
      await SdAiRepository.recordSuggestion({
        workspaceId: workspace.id,
        ticketId: ticket.id,
        userId: user.id,
        kind: 'CLASSIFICATION',
        payload: { tags: ['vpn'] },
      }),
    )

    const rows = await prisma.sdAiSuggestion.findMany({
      where: { ticketId: ticket.id },
      orderBy: { createdAt: 'asc' },
    })
    expect(rows.map((r) => r.kind)).toEqual(['REPLY', 'CLASSIFICATION'])
    expect(rows[0]?.text).toBe('Reinicie o cliente')
    expect(rows[1]?.payload).toEqual({ tags: ['vpn'] })
  })

  it('cascades with the ticket', async () => {
    const { workspace, phase } = await setup()
    const ticket = await seedSdTicket(workspace.id, phase.id)
    await seedSdAiSuggestion(workspace.id, ticket.id)
    await prisma.sdTicket.delete({ where: { id: ticket.id } })
    expect(await prisma.sdAiSuggestion.count()).toBe(0)
  })
})

describe('SdAiComparisonRepository', () => {
  it('lists triaged tickets with names and phase, scoped to the workspace and period', async () => {
    const { workspace, other, phase } = await setup()
    const category = await seedSdCategory(workspace.id, { name: 'Rede' })
    const record = createFakeSdAiTriageRecord()
    const triaged = await seedSdTicket(workspace.id, phase.id, {
      categoryId: category.id,
      tags: ['vpn'],
      solution: 'Reiniciado',
      aiTriage: record as never,
    })
    await seedSdTicket(workspace.id, phase.id) // never triaged
    await seedSdTicket(workspace.id, phase.id, {
      aiTriage: record as never,
      createdAt: new Date(NOW.getTime() - 40 * DAY),
    })
    await seedSdTicket(workspace.id, phase.id, {
      aiTriage: record as never,
      deletedAt: new Date(),
    })
    const otherPhase = await seedSdPhase(other.id)
    await seedSdTicket(other.id, otherPhase.id, { aiTriage: record as never })

    const rows = expectOk(
      await SdAiComparisonRepository.listTriaged(
        workspace.id,
        new Date(NOW.getTime() - 30 * DAY),
      ),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: triaged.id,
      phaseCategory: 'RESOLVED',
      category: { id: category.id, name: 'Rede' },
      tags: ['vpn'],
      solution: 'Reiniciado',
      subcategory: null,
      department: null,
    })
    expect(rows[0]?.aiTriage).toMatchObject({ applied: ['categoryId'] })
  })

  it('lists suggestions of the workspace within the period', async () => {
    const { workspace, other, user, phase } = await setup()
    const ticket = await seedSdTicket(workspace.id, phase.id)
    const otherPhase = await seedSdPhase(other.id)
    const otherTicket = await seedSdTicket(other.id, otherPhase.id)
    const recent = await seedSdAiSuggestion(workspace.id, ticket.id, {
      userId: user.id,
    })
    await seedSdAiSuggestion(workspace.id, ticket.id, {
      createdAt: new Date(NOW.getTime() - 60 * DAY),
    })
    await seedSdAiSuggestion(other.id, otherTicket.id)

    const rows = expectOk(
      await SdAiComparisonRepository.listSuggestions(workspace.id, WEEK_AGO),
    )
    expect(rows.map((r) => r.id)).toEqual([recent.id])
  })

  it('loads tickets by id inside the workspace, skipping deleted and empty lists', async () => {
    const { workspace, other, phase } = await setup()
    const mine = await seedSdTicket(workspace.id, phase.id)
    const deleted = await seedSdTicket(workspace.id, phase.id, {
      deletedAt: new Date(),
    })
    const otherPhase = await seedSdPhase(other.id)
    const foreign = await seedSdTicket(other.id, otherPhase.id)

    const rows = expectOk(
      await SdAiComparisonRepository.listTicketsByIds(workspace.id, [
        mine.id,
        deleted.id,
        foreign.id,
      ]),
    )
    expect(rows.map((r) => r.id)).toEqual([mine.id])
    expect(
      expectOk(
        await SdAiComparisonRepository.listTicketsByIds(workspace.id, []),
      ),
    ).toEqual([])
  })

  it('lists only public replies written by agents', async () => {
    const { workspace, user, phase } = await setup()
    const ticket = await seedSdTicket(workspace.id, phase.id)
    await seedSdTicketMessage(workspace.id, ticket.id, {
      authorUserId: user.id,
      body: 'Resposta pública',
    })
    await seedSdTicketMessage(workspace.id, ticket.id, {
      authorUserId: user.id,
      visibility: 'INTERNAL',
      body: 'Nota interna',
    })
    await seedSdTicketMessage(workspace.id, ticket.id, {
      authorKind: 'REQUESTER',
      authorUserId: user.id,
      body: 'Do solicitante',
    })
    await seedSdTicketMessage(workspace.id, ticket.id, {
      authorUserId: user.id,
      deletedAt: new Date(),
      body: 'Apagada',
    })
    await seedSdTicketMessage(workspace.id, ticket.id, { body: 'Sem autor' })

    const rows = expectOk(
      await SdAiComparisonRepository.listAgentMessages(workspace.id, [
        ticket.id,
      ]),
    )
    expect(rows.map((r) => r.body)).toEqual(['Resposta pública'])
    expect(
      expectOk(
        await SdAiComparisonRepository.listAgentMessages(workspace.id, []),
      ),
    ).toEqual([])
  })

  it('sums ServiceDesk AI usage by feature within the window only', async () => {
    const { workspace, other } = await setup()
    await seedAiUsage(workspace.id, {
      feature: 'SERVICEDESK_TRIAGE',
      costUsd: 0.25,
    })
    await seedAiUsage(workspace.id, {
      feature: 'SERVICEDESK_TRIAGE',
      costUsd: 0.5,
    })
    await seedAiUsage(workspace.id, { feature: 'SERVICEDESK_COPILOT' })
    await seedAiUsage(workspace.id, { feature: 'CRM_ASSISTANT' })
    await seedAiUsage(workspace.id, {
      feature: 'SERVICEDESK_PRE_SERVICE',
      createdAt: new Date(NOW.getTime() - 60 * DAY),
    })
    await seedAiUsage(other.id, { feature: 'SERVICEDESK_TRIAGE' })

    const rows = expectOk(
      await SdAiComparisonRepository.usageByFeature(
        workspace.id,
        WEEK_AGO,
        new Date(NOW.getTime() + 60 * 60 * 1000),
      ),
    )
    const byFeature = Object.fromEntries(rows.map((r) => [r.feature, r]))
    expect(byFeature.SERVICEDESK_TRIAGE).toMatchObject({ calls: 2 })
    expect(byFeature.SERVICEDESK_TRIAGE?.costUsd).toBeCloseTo(0.75)
    expect(byFeature.SERVICEDESK_COPILOT).toMatchObject({ calls: 1 })
    expect(Object.keys(byFeature).sort()).toEqual([
      'SERVICEDESK_COPILOT',
      'SERVICEDESK_TRIAGE',
    ])
  })

  it('groups pre-service outcomes, ignoring the copilot', async () => {
    const { workspace, other } = await setup()
    const create = (
      workspaceId: string,
      mode: string,
      outcome: string | null,
    ) =>
      prisma.sdAiConversation.create({ data: { workspaceId, mode, outcome } })
    await create(workspace.id, 'PRE_SERVICE', 'resolved_by_kb')
    await create(workspace.id, 'PRE_SERVICE', 'resolved_by_kb')
    await create(workspace.id, 'PRE_SERVICE', null)
    await create(workspace.id, 'COPILOT', 'resolved_by_kb')
    await create(other.id, 'PRE_SERVICE', 'abandoned')

    const rows = expectOk(
      await SdAiComparisonRepository.preServiceOutcomes(workspace.id, WEEK_AGO),
    )
    expect(rows).toHaveLength(2)
    expect(rows.find((r) => r.outcome === 'resolved_by_kb')?.total).toBe(2)
    expect(rows.find((r) => r.outcome === null)?.total).toBe(1)
  })

  it('resolves user names', async () => {
    const user = await seedUser({ name: 'Ana Souza' })
    expect(
      expectOk(await SdAiComparisonRepository.userNames([user.id])),
    ).toEqual([{ id: user.id, name: 'Ana Souza' }])
    expect(expectOk(await SdAiComparisonRepository.userNames([]))).toEqual([])
  })
})
