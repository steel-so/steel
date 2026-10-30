import { afterEach, describe, expect, it, vi } from 'vitest'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { WhatsAppConversationRepository } from '../whatsapp-conversation.repository'

afterEach(() => {
  vi.restoreAllMocks()
})

let counter = 0
function next() {
  counter += 1
  return `${Date.now()}${counter}`
}

async function fixtures() {
  const [workspace, ana, bia] = await Promise.all([
    seedWorkspace(),
    seedUser(),
    seedUser(),
  ])
  const connection = await prisma.whatsAppConnection.create({
    data: {
      workspaceId: workspace.id,
      provider: 'ZAPI',
      label: 'Suporte',
      phoneNumber: `5511${next()}`,
      zapiInstanceId: `instance-${next()}`,
      encryptedZapiToken: 'enc:token',
      createdById: ana.id,
    },
  })
  return { workspace, ana, bia, connection }
}

type Fixtures = Awaited<ReturnType<typeof fixtures>>

async function conversation(
  fx: Fixtures,
  data: Partial<
    Parameters<typeof prisma.whatsAppConversation.create>[0]['data']
  > = {},
) {
  const contact = await prisma.whatsAppContact.create({
    data: { workspaceId: fx.workspace.id, waId: `55${next()}`, name: 'Maria' },
  })
  return prisma.whatsAppConversation.create({
    data: {
      workspaceId: fx.workspace.id,
      connectionId: fx.connection.id,
      contactId: contact.id,
      ...data,
    } as never,
  })
}

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000)

describe('WhatsAppConversationRepository · distribution queries', () => {
  describe('countOpenByAssignees()', () => {
    it('counts only open, visible conversations of the given agents', async () => {
      const fx = await fixtures()
      await conversation(fx, { assignedUserId: fx.ana.id, status: 'NEW' })
      await conversation(fx, {
        assignedUserId: fx.ana.id,
        status: 'IN_PROGRESS',
      })
      await conversation(fx, { assignedUserId: fx.ana.id, status: 'CLOSED' })
      await conversation(fx, {
        assignedUserId: fx.ana.id,
        archivedAt: new Date(),
      })
      await conversation(fx, {
        assignedUserId: fx.ana.id,
        deletedAt: new Date(),
      })
      await conversation(fx, { assignedUserId: fx.bia.id })
      await conversation(fx, { assignedUserId: null })

      const counts = expectOk(
        await WhatsAppConversationRepository.countOpenByAssignees(
          fx.workspace.id,
          [fx.ana.id, fx.bia.id],
        ),
      )
      expect(counts.get(fx.ana.id)).toBe(2)
      expect(counts.get(fx.bia.id)).toBe(1)
    })

    it('leaves out agents that were not asked for and other workspaces', async () => {
      const fx = await fixtures()
      const other = await fixtures()
      await conversation(fx, { assignedUserId: fx.ana.id })
      await conversation(other, { assignedUserId: fx.ana.id })

      const counts = expectOk(
        await WhatsAppConversationRepository.countOpenByAssignees(
          fx.workspace.id,
          [fx.bia.id],
        ),
      )
      expect(counts.size).toBe(0)
      const own = expectOk(
        await WhatsAppConversationRepository.countOpenByAssignees(
          fx.workspace.id,
          [fx.ana.id],
        ),
      )
      expect(own.get(fx.ana.id)).toBe(1)
    })

    it('does not count ServiceDesk conversations', async () => {
      const fx = await fixtures()
      const sd = await prisma.whatsAppConnection.create({
        data: {
          workspaceId: fx.workspace.id,
          provider: 'ZAPI',
          label: 'Chamados',
          phoneNumber: `5511${next()}`,
          zapiInstanceId: `instance-${next()}`,
          encryptedZapiToken: 'enc:token',
          createdById: fx.ana.id,
          module: 'SERVICE_DESK',
        },
      })
      await conversation(
        { ...fx, connection: sd },
        { assignedUserId: fx.ana.id },
      )
      const counts = expectOk(
        await WhatsAppConversationRepository.countOpenByAssignees(
          fx.workspace.id,
          [fx.ana.id],
        ),
      )
      expect(counts.size).toBe(0)
    })

    it('short-circuits an empty list', async () => {
      const spy = vi.spyOn(prisma.whatsAppConversation, 'groupBy')
      expect(
        expectOk(
          await WhatsAppConversationRepository.countOpenByAssignees('w', []),
        ).size,
      ).toBe(0)
      expect(spy).not.toHaveBeenCalled()
    })

    it('reports a database failure', async () => {
      vi.spyOn(prisma.whatsAppConversation, 'groupBy').mockRejectedValueOnce(
        new Error('boom'),
      )
      expectErr(
        await WhatsAppConversationRepository.countOpenByAssignees('w', ['u']),
        'DATABASE_ERROR',
      )
    })
  })

  describe('listAwaitingDistribution()', () => {
    it('lists the open queue, oldest in the queue first', async () => {
      const fx = await fixtures()
      const newest = await conversation(fx, { queuedAt: minutesAgo(1) })
      const oldest = await conversation(fx, { queuedAt: minutesAgo(30) })
      const legacy = await conversation(fx, { queuedAt: null })
      // None of these belong to the queue:
      await conversation(fx, { assignedUserId: fx.ana.id })
      await conversation(fx, { aiActive: true })
      await conversation(fx, { status: 'CLOSED' })
      await conversation(fx, { archivedAt: new Date() })
      await conversation(fx, { deletedAt: new Date() })

      const queue = expectOk(
        await WhatsAppConversationRepository.listAwaitingDistribution(
          fx.workspace.id,
          10,
        ),
      )
      expect(queue.map((c) => c.id)).toEqual([legacy.id, oldest.id, newest.id])
    })

    it('honours the limit', async () => {
      const fx = await fixtures()
      await conversation(fx, { queuedAt: minutesAgo(3) })
      await conversation(fx, { queuedAt: minutesAgo(2) })
      expect(
        expectOk(
          await WhatsAppConversationRepository.listAwaitingDistribution(
            fx.workspace.id,
            1,
          ),
        ),
      ).toHaveLength(1)
    })

    it('reports a database failure', async () => {
      vi.spyOn(prisma.whatsAppConversation, 'findMany').mockRejectedValueOnce(
        new Error('boom'),
      )
      expectErr(
        await WhatsAppConversationRepository.listAwaitingDistribution('w', 5),
        'DATABASE_ERROR',
      )
    })
  })

  describe('claimForAssignment()', () => {
    it('assigns an open unassigned conversation and clears its queue clock', async () => {
      const fx = await fixtures()
      const waiting = await conversation(fx, { queuedAt: minutesAgo(5) })

      const claimed = expectOk(
        await WhatsAppConversationRepository.claimForAssignment(
          waiting.id,
          fx.workspace.id,
          fx.ana.id,
        ),
      )
      expect(claimed).toBe(true)
      const row = await prisma.whatsAppConversation.findUnique({
        where: { id: waiting.id },
      })
      expect(row).toMatchObject({
        assignedUserId: fx.ana.id,
        status: 'IN_PROGRESS',
        queuedAt: null,
      })
    })

    it('lets only one of two simultaneous claims win', async () => {
      const fx = await fixtures()
      const waiting = await conversation(fx)

      const results = await Promise.all([
        WhatsAppConversationRepository.claimForAssignment(
          waiting.id,
          fx.workspace.id,
          fx.ana.id,
        ),
        WhatsAppConversationRepository.claimForAssignment(
          waiting.id,
          fx.workspace.id,
          fx.bia.id,
        ),
      ])
      const winners = results.map((result) => expectOk(result))
      expect(winners.filter(Boolean)).toHaveLength(1)
    })

    it('never takes a conversation a person already holds (manual wins)', async () => {
      const fx = await fixtures()
      const taken = await conversation(fx, {
        assignedUserId: fx.bia.id,
        status: 'IN_PROGRESS',
      })
      expect(
        expectOk(
          await WhatsAppConversationRepository.claimForAssignment(
            taken.id,
            fx.workspace.id,
            fx.ana.id,
          ),
        ),
      ).toBe(false)
      const row = await prisma.whatsAppConversation.findUnique({
        where: { id: taken.id },
      })
      expect(row?.assignedUserId).toBe(fx.bia.id)
    })

    it.each([
      ['closed', { status: 'CLOSED' }],
      ['answered by the AI', { aiActive: true }],
      ['archived', { archivedAt: new Date() }],
      ['deleted', { deletedAt: new Date() }],
    ])('does not claim a %s conversation', async (_label, data) => {
      const fx = await fixtures()
      const row = await conversation(fx, data as never)
      expect(
        expectOk(
          await WhatsAppConversationRepository.claimForAssignment(
            row.id,
            fx.workspace.id,
            fx.ana.id,
          ),
        ),
      ).toBe(false)
    })

    it('does not claim across workspaces', async () => {
      const fx = await fixtures()
      const waiting = await conversation(fx)
      expect(
        expectOk(
          await WhatsAppConversationRepository.claimForAssignment(
            waiting.id,
            'another-workspace',
            fx.ana.id,
          ),
        ),
      ).toBe(false)
    })

    it('reports a database failure', async () => {
      vi.spyOn(prisma.whatsAppConversation, 'updateMany').mockRejectedValueOnce(
        new Error('boom'),
      )
      expectErr(
        await WhatsAppConversationRepository.claimForAssignment('c', 'w', 'u'),
        'DATABASE_ERROR',
      )
    })
  })

  describe('listUnattendedForReminder()', () => {
    const base = () => ({
      cutoff: minutesAgo(10),
      notBefore: minutesAgo(48 * 60),
      limit: 50,
    })

    it('finds the conversations that waited past the cutoff', async () => {
      const fx = await fixtures()
      const stale = await conversation(fx, { queuedAt: minutesAgo(25) })
      const legacy = await conversation(fx, {
        queuedAt: null,
        createdAt: minutesAgo(40),
      })
      await conversation(fx, { queuedAt: minutesAgo(3) })

      const found = expectOk(
        await WhatsAppConversationRepository.listUnattendedForReminder({
          ...base(),
          workspaceIds: { in: [fx.workspace.id] },
        }),
      )
      expect(found.map((c) => c.id).sort()).toEqual(
        [stale.id, legacy.id].sort(),
      )
      expect(found[0].contact).toBeDefined()
    })

    it('skips what is not waiting, already reminded, or too old', async () => {
      const fx = await fixtures()
      await conversation(fx, {
        queuedAt: minutesAgo(25),
        assignedUserId: fx.ana.id,
      })
      await conversation(fx, { queuedAt: minutesAgo(25), aiActive: true })
      await conversation(fx, { queuedAt: minutesAgo(25), status: 'CLOSED' })
      await conversation(fx, {
        queuedAt: minutesAgo(25),
        archivedAt: new Date(),
      })
      await conversation(fx, {
        queuedAt: minutesAgo(25),
        deletedAt: new Date(),
      })
      await conversation(fx, {
        queuedAt: minutesAgo(25),
        unassignedReminderAt: minutesAgo(5),
      })
      await conversation(fx, { queuedAt: minutesAgo(49 * 60) })

      expect(
        expectOk(
          await WhatsAppConversationRepository.listUnattendedForReminder({
            ...base(),
            workspaceIds: { in: [fx.workspace.id] },
          }),
        ),
      ).toEqual([])
    })

    it('skips a conversation a chatbot is still talking to', async () => {
      const fx = await fixtures()
      const talking = await conversation(fx, { queuedAt: minutesAgo(25) })
      const finished = await conversation(fx, { queuedAt: minutesAgo(25) })
      const bot = await prisma.whatsAppChatbot.create({
        data: {
          workspaceId: fx.workspace.id,
          name: 'Bot',
          draft: {} as never,
        },
      })
      const session = (
        conversationId: string,
        status: 'RUNNING' | 'COMPLETED',
      ) =>
        prisma.whatsAppChatbotSession.create({
          data: {
            workspaceId: fx.workspace.id,
            chatbotId: bot.id,
            conversationId,
            status,
            botVersion: 1,
            state: {},
            definition: {},
          },
        })
      await session(talking.id, 'RUNNING')
      await session(finished.id, 'COMPLETED')

      const found = expectOk(
        await WhatsAppConversationRepository.listUnattendedForReminder({
          ...base(),
          workspaceIds: { in: [fx.workspace.id] },
        }),
      )
      expect(found.map((c) => c.id)).toEqual([finished.id])
    })

    it('applies the workspace filter in both forms', async () => {
      const fx = await fixtures()
      const other = await fixtures()
      const mine = await conversation(fx, { queuedAt: minutesAgo(25) })
      await conversation(other, { queuedAt: minutesAgo(25) })

      const included = expectOk(
        await WhatsAppConversationRepository.listUnattendedForReminder({
          ...base(),
          workspaceIds: { in: [fx.workspace.id] },
        }),
      )
      expect(included.map((c) => c.id)).toEqual([mine.id])

      const excluded = expectOk(
        await WhatsAppConversationRepository.listUnattendedForReminder({
          ...base(),
          workspaceIds: { notIn: [other.workspace.id] },
        }),
      )
      expect(excluded.map((c) => c.workspaceId)).not.toContain(
        other.workspace.id,
      )
    })

    it('honours the limit, oldest first', async () => {
      const fx = await fixtures()
      const first = await conversation(fx, {
        queuedAt: minutesAgo(30),
        createdAt: minutesAgo(60),
      })
      await conversation(fx, {
        queuedAt: minutesAgo(30),
        createdAt: minutesAgo(20),
      })
      const found = expectOk(
        await WhatsAppConversationRepository.listUnattendedForReminder({
          ...base(),
          workspaceIds: { in: [fx.workspace.id] },
          limit: 1,
        }),
      )
      expect(found.map((c) => c.id)).toEqual([first.id])
    })

    it('reports a database failure', async () => {
      vi.spyOn(prisma.whatsAppConversation, 'findMany').mockRejectedValueOnce(
        new Error('boom'),
      )
      expectErr(
        await WhatsAppConversationRepository.listUnattendedForReminder({
          ...base(),
          workspaceIds: { in: [] },
        }),
        'DATABASE_ERROR',
      )
    })
  })

  describe('claimUnassignedReminder()', () => {
    it('reserves one reminder per streak', async () => {
      const fx = await fixtures()
      const waiting = await conversation(fx, { queuedAt: minutesAgo(25) })
      const now = new Date()

      expect(
        expectOk(
          await WhatsAppConversationRepository.claimUnassignedReminder(
            waiting.id,
            now,
          ),
        ),
      ).toBe(true)
      expect(
        expectOk(
          await WhatsAppConversationRepository.claimUnassignedReminder(
            waiting.id,
            now,
          ),
        ),
      ).toBe(false)
    })

    it('lets only one of two simultaneous ticks send the reminder', async () => {
      const fx = await fixtures()
      const waiting = await conversation(fx)
      const results = await Promise.all([
        WhatsAppConversationRepository.claimUnassignedReminder(
          waiting.id,
          new Date(),
        ),
        WhatsAppConversationRepository.claimUnassignedReminder(
          waiting.id,
          new Date(),
        ),
      ])
      expect(
        results.map((result) => expectOk(result)).filter(Boolean),
      ).toHaveLength(1)
    })

    it('starts over once the conversation re-enters the queue', async () => {
      const fx = await fixtures()
      const waiting = await conversation(fx)
      await WhatsAppConversationRepository.claimUnassignedReminder(
        waiting.id,
        new Date(),
      )
      // Re-entering the queue resets the reminder (queueEntry()).
      await WhatsAppConversationRepository.update(waiting.id, {
        queuedAt: new Date(),
        unassignedReminderAt: null,
      })
      expect(
        expectOk(
          await WhatsAppConversationRepository.claimUnassignedReminder(
            waiting.id,
            new Date(),
          ),
        ),
      ).toBe(true)
    })

    it('does not mark a conversation somebody took', async () => {
      const fx = await fixtures()
      const taken = await conversation(fx, { assignedUserId: fx.ana.id })
      expect(
        expectOk(
          await WhatsAppConversationRepository.claimUnassignedReminder(
            taken.id,
            new Date(),
          ),
        ),
      ).toBe(false)
    })

    it('reports a database failure', async () => {
      vi.spyOn(prisma.whatsAppConversation, 'updateMany').mockRejectedValueOnce(
        new Error('boom'),
      )
      expectErr(
        await WhatsAppConversationRepository.claimUnassignedReminder(
          'c',
          new Date(),
        ),
        'DATABASE_ERROR',
      )
    })
  })
})
