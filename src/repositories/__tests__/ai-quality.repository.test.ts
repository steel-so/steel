import { describe, expect, it, vi } from 'vitest'
import {
  seedAiFeedback,
  seedWhatsAppMessage,
  seedWhatsAppThread,
} from '@/src/__tests__/factories/ai-quality.factory'
import { seedAiUsage } from '@/src/__tests__/factories/ai-settings.factory'
import {
  seedSdKbArticle,
  seedSdTicket,
} from '@/src/__tests__/factories/sd-kb.factory'
import {
  seedSteelAgent,
  seedSteelAgentRun,
} from '@/src/__tests__/factories/steel-agent.factory'
import {
  seedAiConversation,
  seedAiMessage,
} from '@/src/__tests__/factories/steel-ai.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { AiQualityRepository } from '../ai-quality.repository'

const RANGE = {
  from: new Date('2026-10-01T00:00:00.000Z'),
  to: new Date('2026-11-01T00:00:00.000Z'),
}
const IN_RANGE = new Date('2026-10-05T10:00:00.000Z')

async function seedRatings() {
  const [workspace, other, ana, bob] = await Promise.all([
    seedWorkspace(),
    seedWorkspace(),
    seedUser({ name: 'Ana' }),
    seedUser({ name: 'Bob' }),
  ])
  await Promise.all([
    seedAiFeedback({
      workspaceId: workspace.id,
      userId: ana.id,
      targetId: 'm1',
      rating: 'UP',
      modelKey: 'openai:gpt-4o-mini',
      createdAt: IN_RANGE,
    }),
    seedAiFeedback({
      workspaceId: workspace.id,
      userId: ana.id,
      targetId: 'm2',
      rating: 'DOWN',
      reason: 'incorrect',
      modelKey: 'openai:gpt-4o-mini',
      createdAt: new Date('2026-10-06T10:00:00.000Z'),
    }),
    seedAiFeedback({
      workspaceId: workspace.id,
      userId: bob.id,
      targetId: 'w1',
      surface: 'WHATSAPP_AUTO_REPLY',
      rating: 'DOWN',
      comment: 'Respondeu errado',
      createdAt: new Date('2026-10-06T11:00:00.000Z'),
    }),
    // Outside the range and in another workspace: never counted.
    seedAiFeedback({
      workspaceId: workspace.id,
      userId: ana.id,
      targetId: 'old',
      createdAt: new Date('2026-09-30T23:59:59.000Z'),
    }),
    seedAiFeedback({
      workspaceId: other.id,
      userId: ana.id,
      targetId: 'x',
      createdAt: IN_RANGE,
    }),
  ])
  return { workspace, ana, bob }
}

describe('AiQualityRepository', () => {
  it('groups ratings by surface, model and rating (optionally per user)', async () => {
    const { workspace, ana } = await seedRatings()
    const groups = expectOk(
      await AiQualityRepository.groupRatings(workspace.id, RANGE),
    )
    const total = groups.reduce((sum, g) => sum + g.count, 0)
    expect(total).toBe(3)
    expect(groups).toContainEqual({
      surface: 'WHATSAPP_AUTO_REPLY',
      modelKey: null,
      rating: 'DOWN',
      count: 1,
    })
    const mine = expectOk(
      await AiQualityRepository.groupRatings(workspace.id, RANGE, ana.id),
    )
    expect(mine.reduce((sum, g) => sum + g.count, 0)).toBe(2)
  })

  it('counts ratings per UTC day', async () => {
    const { workspace, ana } = await seedRatings()
    expect(
      expectOk(await AiQualityRepository.dailyRatings(workspace.id, RANGE)),
    ).toEqual([
      { day: '2026-10-05', up: 1, down: 0 },
      { day: '2026-10-06', up: 0, down: 2 },
    ])
    expect(
      expectOk(
        await AiQualityRepository.dailyRatings(workspace.id, RANGE, ana.id),
      ),
    ).toEqual([
      { day: '2026-10-05', up: 1, down: 0 },
      { day: '2026-10-06', up: 0, down: 1 },
    ])
  })

  it('lists the latest thumbs down with who rated', async () => {
    const { workspace, ana } = await seedRatings()
    const rows = expectOk(
      await AiQualityRepository.latestDown(workspace.id, RANGE, { take: 10 }),
    )
    expect(rows.map((r) => r.targetId)).toEqual(['w1', 'm2'])
    expect(rows[0]).toMatchObject({
      userName: 'Bob',
      comment: 'Respondeu errado',
    })
    const mine = expectOk(
      await AiQualityRepository.latestDown(workspace.id, RANGE, {
        userId: ana.id,
        take: 10,
      }),
    )
    expect(mine.map((r) => r.targetId)).toEqual(['m2'])
  })

  it('pages the CSV rows oldest first with a cursor', async () => {
    const { workspace } = await seedRatings()
    const first = expectOk(
      await AiQualityRepository.exportPage(workspace.id, RANGE, { take: 2 }),
    )
    expect(first.map((r) => r.targetId)).toEqual(['m1', 'm2'])
    const next = expectOk(
      await AiQualityRepository.exportPage(workspace.id, RANGE, {
        take: 2,
        cursor: first[1].id,
      }),
    )
    expect(next.map((r) => r.targetId)).toEqual(['w1'])
  })

  it('counts WhatsApp conversations the AI closed without a human', async () => {
    const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
    const closed = {
      status: 'CLOSED' as const,
      closedAt: new Date('2026-10-10T12:00:00.000Z'),
    }
    const onlyAi = await seedWhatsAppThread(workspace.id, user.id, closed)
    const withAgent = await seedWhatsAppThread(workspace.id, user.id, closed)
    const noAi = await seedWhatsAppThread(workspace.id, user.id, closed)
    const open = await seedWhatsAppThread(workspace.id, user.id)
    const outside = await seedWhatsAppThread(workspace.id, user.id, {
      status: 'CLOSED',
      closedAt: new Date('2026-09-10T12:00:00.000Z'),
    })
    await Promise.all([
      seedWhatsAppMessage(workspace.id, onlyAi.id, { direction: 'IN' }),
      seedWhatsAppMessage(workspace.id, onlyAi.id, { sentByAi: true }),
      seedWhatsAppMessage(workspace.id, withAgent.id, { sentByAi: true }),
      seedWhatsAppMessage(workspace.id, withAgent.id, {
        senderUserId: user.id,
      }),
      seedWhatsAppMessage(workspace.id, noAi.id, { senderUserId: user.id }),
      seedWhatsAppMessage(workspace.id, open.id, { sentByAi: true }),
      seedWhatsAppMessage(workspace.id, outside.id, { sentByAi: true }),
    ])
    expect(
      expectOk(
        await AiQualityRepository.whatsappResolution(workspace.id, RANGE),
      ),
    ).toEqual({ handled: 2, resolved: 1 })
  })

  it('counts ServiceDesk pre-services resolved by the knowledge base', async () => {
    const workspace = await seedWorkspace()
    await prisma.sdAiConversation.createMany({
      data: [
        {
          workspaceId: workspace.id,
          mode: 'PRE_SERVICE',
          outcome: 'resolved_by_kb',
          createdAt: IN_RANGE,
        },
        {
          workspaceId: workspace.id,
          mode: 'PRE_SERVICE',
          outcome: 'ticket_opened',
          createdAt: IN_RANGE,
        },
        { workspaceId: workspace.id, mode: 'COPILOT', createdAt: IN_RANGE },
        {
          workspaceId: workspace.id,
          mode: 'PRE_SERVICE',
          outcome: 'resolved_by_kb',
          createdAt: new Date('2026-09-01T00:00:00.000Z'),
        },
      ],
    })
    expect(
      expectOk(
        await AiQualityRepository.servicedeskResolution(workspace.id, RANGE),
      ),
    ).toEqual({ handled: 2, resolved: 1 })
  })

  it('sums the AI cost of the asked features', async () => {
    const workspace = await seedWorkspace()
    await Promise.all([
      seedAiUsage(workspace.id, {
        feature: 'WHATSAPP_REPLY',
        costUsd: 1.5,
        createdAt: IN_RANGE,
      }),
      seedAiUsage(workspace.id, {
        feature: 'WHATSAPP_REPLY',
        costUsd: 0.5,
        createdAt: IN_RANGE,
      }),
      seedAiUsage(workspace.id, {
        feature: 'STEEL_ASSISTANT',
        costUsd: 9,
        createdAt: IN_RANGE,
      }),
    ])
    expect(
      expectOk(
        await AiQualityRepository.featureCosts(workspace.id, RANGE, [
          'WHATSAPP_REPLY',
          'SERVICEDESK_PRE_SERVICE',
        ]),
      ),
    ).toEqual({ WHATSAPP_REPLY: 2 })
  })

  it('resolves where each rated answer lives', async () => {
    const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
    const conversation = await seedAiConversation(workspace.id, user.id)
    const message = await seedAiMessage(conversation.id, { role: 'ASSISTANT' })
    const agent = await seedSteelAgent({ workspaceId: workspace.id })
    const run = await seedSteelAgentRun({
      workspaceId: workspace.id,
      agentId: agent.id,
    })
    const ticket = await seedSdTicket(workspace.id)
    const article = await seedSdKbArticle(workspace.id)
    const thread = await seedWhatsAppThread(workspace.id, user.id)
    const wa = await seedWhatsAppMessage(workspace.id, thread.id, {
      sentByAi: true,
    })

    const empty = expectOk(
      await AiQualityRepository.linkContext(workspace.id, []),
    )
    expect(empty.chats.size + empty.tickets.size).toBe(0)

    const context = expectOk(
      await AiQualityRepository.linkContext(workspace.id, [
        { surface: 'STEEL_AI_MESSAGE', targetId: message.id },
        { surface: 'STEEL_AGENT_RUN', targetId: run.id },
        { surface: 'SD_COPILOT', targetId: ticket.id },
        { surface: 'SD_TRIAGE', targetId: ticket.id },
        { surface: 'SD_KCS_DRAFT', targetId: article.id },
        { surface: 'WHATSAPP_AUTO_REPLY', targetId: wa.id },
      ]),
    )
    expect(context.chats.get(message.id)).toEqual({
      conversationId: conversation.id,
      ownerId: user.id,
    })
    expect(context.agentRuns.get(run.id)).toEqual({ agentId: agent.id })
    expect(context.tickets.get(ticket.id)).toEqual({ number: ticket.number })
    expect(context.articles.has(article.id)).toBe(true)
    expect(context.whatsapp.get(wa.id)).toEqual({ conversationId: thread.id })
  })

  it('returns DATABASE_ERROR when Prisma fails', async () => {
    const boom = () => Promise.reject(new Error('boom'))
    vi.spyOn(prisma.aiFeedback, 'groupBy').mockImplementationOnce(boom as never)
    vi.spyOn(prisma, '$queryRaw').mockImplementation(boom as never)
    vi.spyOn(prisma.aiFeedback, 'findMany').mockImplementation(boom as never)
    vi.spyOn(prisma.sdAiConversation, 'count').mockImplementationOnce(
      boom as never,
    )
    vi.spyOn(prisma.aiUsage, 'groupBy').mockImplementationOnce(boom as never)
    vi.spyOn(prisma.sdTicket, 'findMany').mockImplementationOnce(boom as never)

    const results = [
      await AiQualityRepository.groupRatings('w', RANGE),
      await AiQualityRepository.dailyRatings('w', RANGE),
      await AiQualityRepository.latestDown('w', RANGE, { take: 1 }),
      await AiQualityRepository.exportPage('w', RANGE, { take: 1 }),
      await AiQualityRepository.whatsappResolution('w', RANGE),
      await AiQualityRepository.servicedeskResolution('w', RANGE),
      await AiQualityRepository.featureCosts('w', RANGE, ['WHATSAPP_REPLY']),
      await AiQualityRepository.linkContext('w', [
        { surface: 'SD_COPILOT', targetId: 't' },
      ]),
    ]
    for (const result of results) {
      expect(expectErr(result).code).toBe('DATABASE_ERROR')
    }
    vi.restoreAllMocks()
  })
})
