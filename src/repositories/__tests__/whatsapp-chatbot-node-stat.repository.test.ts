import { afterEach, describe, expect, it, vi } from 'vitest'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { blankFlow } from '@/src/lib/whatsapp/chatbot/templates'
import { WhatsAppChatbotRepository } from '../whatsapp-chatbot.repository'
import { WhatsAppChatbotNodeStatRepository as Stats } from '../whatsapp-chatbot-node-stat.repository'

afterEach(() => {
  vi.restoreAllMocks()
})

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

async function seedBot() {
  const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
  const bot = expectOk(
    await WhatsAppChatbotRepository.create({
      workspaceId: workspace.id,
      name: 'Bot',
      triggerKind: 'NEW_CONVERSATION',
      keywords: [],
      sessionTtlMinutes: 720,
      draft: blankFlow() as never,
      createdByUserId: user.id,
    }),
  )
  return { workspace, user, bot }
}

describe('WhatsAppChatbotNodeStatRepository', () => {
  it('adds up the counts of several runs on the same day', async () => {
    const { workspace, bot } = await seedBot()
    const input = {
      workspaceId: workspace.id,
      chatbotId: bot.id,
      day: day('2026-11-03'),
    }

    expect(
      expectOk(
        await Stats.increment(input, [
          { nodeId: 'start', entries: 1, exits: 1 },
          { nodeId: 'menu', entries: 1, exits: 0 },
        ]),
      ),
    ).toBe(2)
    expectOk(
      await Stats.increment(input, [{ nodeId: 'menu', entries: 2, exits: 1 }]),
    )

    const totals = expectOk(
      await Stats.totalsSince(workspace.id, bot.id, day('2026-11-01')),
    )
    expect(totals).toContainEqual({ nodeId: 'start', entries: 1, exits: 1 })
    expect(totals).toContainEqual({ nodeId: 'menu', entries: 3, exits: 1 })
    expect(totals).toHaveLength(2)
  })

  it('writes nothing for an empty run', async () => {
    const { workspace, bot } = await seedBot()
    expect(
      expectOk(
        await Stats.increment(
          {
            workspaceId: workspace.id,
            chatbotId: bot.id,
            day: day('2026-11-03'),
          },
          [],
        ),
      ),
    ).toBe(0)
    expect(await prisma.whatsAppChatbotNodeStat.count()).toBe(0)
  })

  it('sums only the window, per bot and per workspace', async () => {
    const { workspace, bot } = await seedBot()
    const other = await seedBot()
    const base = { workspaceId: workspace.id, chatbotId: bot.id }
    await Stats.increment({ ...base, day: day('2026-10-01') }, [
      { nodeId: 'menu', entries: 5, exits: 5 },
    ])
    await Stats.increment({ ...base, day: day('2026-11-02') }, [
      { nodeId: 'menu', entries: 1, exits: 0 },
    ])
    await Stats.increment(
      {
        workspaceId: other.workspace.id,
        chatbotId: other.bot.id,
        day: day('2026-11-02'),
      },
      [{ nodeId: 'menu', entries: 9, exits: 9 }],
    )

    expect(
      expectOk(
        await Stats.totalsSince(workspace.id, bot.id, day('2026-10-15')),
      ),
    ).toEqual([{ nodeId: 'menu', entries: 1, exits: 0 }])
    // A bot of another workspace is invisible even with its id.
    expect(
      expectOk(
        await Stats.totalsSince(other.workspace.id, bot.id, day('2026-10-01')),
      ),
    ).toEqual([])
  })

  it('prunes the days before the cutoff and goes away with the bot', async () => {
    const { workspace, bot } = await seedBot()
    const base = { workspaceId: workspace.id, chatbotId: bot.id }
    await Stats.increment({ ...base, day: day('2026-08-01') }, [
      { nodeId: 'menu', entries: 1, exits: 1 },
    ])
    await Stats.increment({ ...base, day: day('2026-11-02') }, [
      { nodeId: 'menu', entries: 1, exits: 1 },
    ])

    expect(expectOk(await Stats.deleteBefore(day('2026-09-01')))).toBe(1)
    expect(await prisma.whatsAppChatbotNodeStat.count()).toBe(1)

    await WhatsAppChatbotRepository.delete(bot.id)
    expect(await prisma.whatsAppChatbotNodeStat.count()).toBe(0)
  })

  it('wraps database failures', async () => {
    const { workspace, bot } = await seedBot()
    vi.spyOn(prisma, '$transaction').mockRejectedValue(new Error('down'))
    expectErr(
      await Stats.increment(
        {
          workspaceId: workspace.id,
          chatbotId: bot.id,
          day: day('2026-11-03'),
        },
        [{ nodeId: 'menu', entries: 1, exits: 0 }],
      ),
      'DATABASE_ERROR',
    )
    vi.spyOn(prisma.whatsAppChatbotNodeStat, 'groupBy').mockRejectedValue(
      new Error('down'),
    )
    expectErr(
      await Stats.totalsSince(workspace.id, bot.id, day('2026-11-01')),
      'DATABASE_ERROR',
    )
    vi.spyOn(prisma.whatsAppChatbotNodeStat, 'deleteMany').mockRejectedValue(
      new Error('down'),
    )
    expectErr(await Stats.deleteBefore(day('2026-11-01')), 'DATABASE_ERROR')
  })
})
