import { afterEach, describe, expect, it, vi } from 'vitest'
import { seedChatbotFixtures } from '@/src/__tests__/factories/nov-z2-chatbot-builder.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { initialChatbotState } from '@/src/lib/whatsapp/chatbot/engine'
import { blankFlow, menuFlow } from '@/src/lib/whatsapp/chatbot/templates'
import { WhatsAppChatbotRepository } from '../whatsapp-chatbot.repository'
import { WhatsAppChatbotSessionRepository } from '../whatsapp-chatbot-session.repository'

afterEach(() => {
  vi.restoreAllMocks()
})

async function seed() {
  const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
  const fixtures = await seedChatbotFixtures(workspace.id, user.id)
  return { workspace, user, ...fixtures }
}

function botData(
  workspaceId: string,
  userId: string,
  overrides: Partial<
    Parameters<typeof WhatsAppChatbotRepository.create>[0]
  > = {},
) {
  return {
    workspaceId,
    name: 'Bot',
    triggerKind: 'NEW_CONVERSATION' as const,
    keywords: [],
    sessionTtlMinutes: 720,
    draft: blankFlow() as never,
    createdByUserId: userId,
    ...overrides,
  }
}

async function publish(id: string, connectionId?: string) {
  return WhatsAppChatbotRepository.update(id, {
    status: 'ACTIVE',
    published: menuFlow() as never,
    publishedVersion: 1,
    publishedAt: new Date(),
    ...(connectionId ? { connectionId } : {}),
  })
}

describe('WhatsAppChatbotRepository', () => {
  it('creates, finds, lists, counts and deletes bots per workspace', async () => {
    const { workspace, user } = await seed()
    const other = await seedWorkspace()

    const created = expectOk(
      await WhatsAppChatbotRepository.create(botData(workspace.id, user.id)),
    )
    expect(created.status).toBe('DRAFT')
    await WhatsAppChatbotRepository.create(
      botData(workspace.id, user.id, { name: 'Outro' }),
    )

    expect(
      expectOk(
        await WhatsAppChatbotRepository.findById(created.id, workspace.id),
      )?.id,
    ).toBe(created.id)
    expect(
      expectOk(await WhatsAppChatbotRepository.findById(created.id, other.id)),
    ).toBeNull()
    expect(
      expectOk(await WhatsAppChatbotRepository.listByWorkspace(workspace.id)),
    ).toHaveLength(2)
    expect(expectOk(await WhatsAppChatbotRepository.count(workspace.id))).toBe(
      2,
    )
    expect(expectOk(await WhatsAppChatbotRepository.count(other.id))).toBe(0)

    expectOk(await WhatsAppChatbotRepository.delete(created.id))
    expect(expectOk(await WhatsAppChatbotRepository.count(workspace.id))).toBe(
      1,
    )
  })

  it('updates fields and the status', async () => {
    const { workspace, user } = await seed()
    const bot = expectOk(
      await WhatsAppChatbotRepository.create(botData(workspace.id, user.id)),
    )
    const renamed = expectOk(
      await WhatsAppChatbotRepository.update(bot.id, { name: 'Novo' }),
    )
    expect(renamed.name).toBe('Novo')
    expect(
      expectOk(await WhatsAppChatbotRepository.setStatus(bot.id, 'PAUSED'))
        .status,
    ).toBe('PAUSED')
  })

  it('lists only published ACTIVE bots for the connection, specific first', async () => {
    const { workspace, user, connection } = await seed()
    const wide = expectOk(
      await WhatsAppChatbotRepository.create(botData(workspace.id, user.id)),
    )
    const bound = expectOk(
      await WhatsAppChatbotRepository.create(
        botData(workspace.id, user.id, { connectionId: connection.id }),
      ),
    )
    const draftOnly = expectOk(
      await WhatsAppChatbotRepository.create(botData(workspace.id, user.id)),
    )
    const paused = expectOk(
      await WhatsAppChatbotRepository.create(botData(workspace.id, user.id)),
    )
    await publish(wide.id)
    await publish(bound.id)
    await publish(paused.id)
    await WhatsAppChatbotRepository.setStatus(paused.id, 'PAUSED')
    const otherConnection = await prisma.whatsAppConnection.create({
      data: {
        workspaceId: workspace.id,
        provider: 'ZAPI',
        label: 'Outra',
        phoneNumber: '5511000000000',
        zapiInstanceId: `other-${Date.now()}`,
        encryptedZapiToken: 'enc:x',
        createdById: user.id,
      },
    })
    const elsewhere = expectOk(
      await WhatsAppChatbotRepository.create(
        botData(workspace.id, user.id, { connectionId: otherConnection.id }),
      ),
    )
    await publish(elsewhere.id)

    const runnable = expectOk(
      await WhatsAppChatbotRepository.listRunnable(workspace.id, connection.id),
    )
    expect(runnable.map((bot) => bot.id)).toEqual([bound.id, wide.id])
    expect(runnable.map((bot) => bot.id)).not.toContain(draftOnly.id)
  })

  it('counts sessions per bot and status since a date', async () => {
    const { workspace, user, conversation } = await seed()
    const bot = expectOk(
      await WhatsAppChatbotRepository.create(botData(workspace.id, user.id)),
    )
    await prisma.whatsAppChatbotSession.createMany({
      data: [
        {
          workspaceId: workspace.id,
          chatbotId: bot.id,
          conversationId: conversation.id,
          status: 'COMPLETED',
          botVersion: 1,
          state: initialChatbotState() as never,
          definition: menuFlow() as never,
        },
        {
          workspaceId: workspace.id,
          chatbotId: bot.id,
          conversationId: conversation.id,
          status: 'COMPLETED',
          botVersion: 1,
          state: initialChatbotState() as never,
          definition: menuFlow() as never,
        },
        {
          workspaceId: workspace.id,
          chatbotId: bot.id,
          conversationId: conversation.id,
          status: 'EXPIRED',
          botVersion: 1,
          startedAt: new Date('2020-01-01T00:00:00Z'),
          state: initialChatbotState() as never,
          definition: menuFlow() as never,
        },
      ],
    })
    const counts = expectOk(
      await WhatsAppChatbotRepository.sessionCounts(
        workspace.id,
        new Date(Date.now() - 86_400_000),
      ),
    )
    expect(counts).toEqual([
      { chatbotId: bot.id, status: 'COMPLETED', count: 2 },
    ])
  })

  it('wraps database failures', async () => {
    vi.spyOn(prisma.whatsAppChatbot, 'findMany').mockRejectedValue(
      new Error('x'),
    )
    vi.spyOn(prisma.whatsAppChatbot, 'count').mockRejectedValue(new Error('x'))
    vi.spyOn(prisma.whatsAppChatbot, 'findFirst').mockRejectedValue(
      new Error('x'),
    )
    vi.spyOn(prisma.whatsAppChatbot, 'create').mockRejectedValue(new Error('x'))
    vi.spyOn(prisma.whatsAppChatbot, 'update').mockRejectedValue(new Error('x'))
    vi.spyOn(prisma.whatsAppChatbot, 'delete').mockRejectedValue(new Error('x'))
    vi.spyOn(prisma.whatsAppChatbotSession, 'groupBy').mockRejectedValue(
      new Error('x'),
    )
    expectErr(
      await WhatsAppChatbotRepository.listByWorkspace('w'),
      'DATABASE_ERROR',
    )
    expectErr(
      await WhatsAppChatbotRepository.listRunnable('w', 'c'),
      'DATABASE_ERROR',
    )
    expectErr(await WhatsAppChatbotRepository.count('w'), 'DATABASE_ERROR')
    expectErr(
      await WhatsAppChatbotRepository.findById('i', 'w'),
      'DATABASE_ERROR',
    )
    expectErr(
      await WhatsAppChatbotRepository.create(botData('w', 'u')),
      'DATABASE_ERROR',
    )
    expectErr(await WhatsAppChatbotRepository.update('i', {}), 'DATABASE_ERROR')
    expectErr(await WhatsAppChatbotRepository.delete('i'), 'DATABASE_ERROR')
    expectErr(
      await WhatsAppChatbotRepository.sessionCounts('w', new Date()),
      'DATABASE_ERROR',
    )
  })
})

describe('WhatsAppChatbotSessionRepository', () => {
  async function seedBot() {
    const base = await seed()
    const bot = expectOk(
      await WhatsAppChatbotRepository.create(
        botData(base.workspace.id, base.user.id),
      ),
    )
    const session = {
      workspaceId: base.workspace.id,
      chatbotId: bot.id,
      conversationId: base.conversation.id,
      botVersion: 1,
      state: initialChatbotState() as never,
      definition: menuFlow() as never,
    }
    return { ...base, bot, session }
  }

  it('allows one RUNNING session per conversation', async () => {
    const { session, conversation } = await seedBot()
    const first = expectOk(
      await WhatsAppChatbotSessionRepository.createRunning(session),
    )
    expect(first?.status).toBe('RUNNING')
    // The partial unique index turns the duplicate into a soft `null`.
    expect(
      expectOk(await WhatsAppChatbotSessionRepository.createRunning(session)),
    ).toBeNull()
    expect(
      expectOk(
        await WhatsAppChatbotSessionRepository.findRunningByConversation(
          conversation.id,
        ),
      )?.id,
    ).toBe(first?.id)

    // Once finished, a new one can start.
    expect(
      expectOk(
        await WhatsAppChatbotSessionRepository.finish(
          first?.id as string,
          'COMPLETED',
          'end_node',
          initialChatbotState() as never,
        ),
      ),
    ).toBe(true)
    expect(
      expectOk(await WhatsAppChatbotSessionRepository.createRunning(session)),
    ).not.toBeNull()
  })

  it('finishes a session only once', async () => {
    const { session } = await seedBot()
    const created = expectOk(
      await WhatsAppChatbotSessionRepository.createRunning(session),
    )
    const id = created?.id as string
    expect(
      expectOk(
        await WhatsAppChatbotSessionRepository.finish(id, 'CANCELLED', 'x'),
      ),
    ).toBe(true)
    expect(
      expectOk(
        await WhatsAppChatbotSessionRepository.finish(id, 'FAILED', 'y'),
      ),
    ).toBe(false)
    const found = expectOk(await WhatsAppChatbotSessionRepository.findById(id))
    expect(found).toMatchObject({ status: 'CANCELLED', endReason: 'x' })
    expect(found?.endedAt).not.toBeNull()
  })

  it('updates, finds and detects human handoffs', async () => {
    const { session, conversation } = await seedBot()
    const created = expectOk(
      await WhatsAppChatbotSessionRepository.createRunning(session),
    )
    const id = created?.id as string
    expect(
      expectOk(
        await WhatsAppChatbotSessionRepository.update(id, { endReason: 'z' }),
      ).endReason,
    ).toBe('z')
    expect(
      expectOk(await WhatsAppChatbotSessionRepository.findById('missing')),
    ).toBeNull()
    expect(
      expectOk(
        await WhatsAppChatbotSessionRepository.hasHandedOffToHuman(
          conversation.id,
        ),
      ),
    ).toBe(false)
    await WhatsAppChatbotSessionRepository.finish(id, 'HANDED_OFF_HUMAN', 'h')
    expect(
      expectOk(
        await WhatsAppChatbotSessionRepository.hasHandedOffToHuman(
          conversation.id,
        ),
      ),
    ).toBe(true)
  })

  it('lists sessions of a bot with their contact, filtered by status', async () => {
    const { session, workspace, bot } = await seedBot()
    const created = expectOk(
      await WhatsAppChatbotSessionRepository.createRunning(session),
    )
    await WhatsAppChatbotSessionRepository.finish(
      created?.id as string,
      'COMPLETED',
      'end_node',
    )
    await WhatsAppChatbotSessionRepository.createRunning(session)

    const all = expectOk(
      await WhatsAppChatbotSessionRepository.listByChatbot({
        workspaceId: workspace.id,
        chatbotId: bot.id,
        limit: 10,
      }),
    )
    expect(all).toHaveLength(2)
    expect(all[0]?.conversation.contact.name).toBe('Maria')

    const completed = expectOk(
      await WhatsAppChatbotSessionRepository.listByChatbot({
        workspaceId: workspace.id,
        chatbotId: bot.id,
        status: 'COMPLETED',
        limit: 10,
      }),
    )
    expect(completed).toHaveLength(1)
  })

  it('wraps database failures', async () => {
    vi.spyOn(prisma.whatsAppChatbotSession, 'findUnique').mockRejectedValue(
      new Error('x'),
    )
    vi.spyOn(prisma.whatsAppChatbotSession, 'findFirst').mockRejectedValue(
      new Error('x'),
    )
    vi.spyOn(prisma.whatsAppChatbotSession, 'count').mockRejectedValue(
      new Error('x'),
    )
    vi.spyOn(prisma.whatsAppChatbotSession, 'create').mockRejectedValue(
      new Error('x'),
    )
    vi.spyOn(prisma.whatsAppChatbotSession, 'update').mockRejectedValue(
      new Error('x'),
    )
    vi.spyOn(prisma.whatsAppChatbotSession, 'updateMany').mockRejectedValue(
      new Error('x'),
    )
    vi.spyOn(prisma.whatsAppChatbotSession, 'findMany').mockRejectedValue(
      new Error('x'),
    )
    expectErr(
      await WhatsAppChatbotSessionRepository.findById('i'),
      'DATABASE_ERROR',
    )
    expectErr(
      await WhatsAppChatbotSessionRepository.findRunningByConversation('c'),
      'DATABASE_ERROR',
    )
    expectErr(
      await WhatsAppChatbotSessionRepository.hasHandedOffToHuman('c'),
      'DATABASE_ERROR',
    )
    expectErr(
      await WhatsAppChatbotSessionRepository.createRunning({
        workspaceId: 'w',
        chatbotId: 'b',
        conversationId: 'c',
        botVersion: 1,
        state: {},
        definition: {},
      }),
      'DATABASE_ERROR',
    )
    expectErr(
      await WhatsAppChatbotSessionRepository.update('i', {}),
      'DATABASE_ERROR',
    )
    expectErr(
      await WhatsAppChatbotSessionRepository.finish('i', 'FAILED', 'x'),
      'DATABASE_ERROR',
    )
    expectErr(
      await WhatsAppChatbotSessionRepository.listByChatbot({
        workspaceId: 'w',
        chatbotId: 'b',
        limit: 1,
      }),
      'DATABASE_ERROR',
    )
  })
})
