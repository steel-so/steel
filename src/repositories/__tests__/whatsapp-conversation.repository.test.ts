import { describe, expect, it, vi } from 'vitest'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { WhatsAppConversationRepository } from '../whatsapp-conversation.repository'

async function seedFixtures() {
  const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
  const connection = await prisma.whatsAppConnection.create({
    data: {
      workspaceId: workspace.id,
      provider: 'ZAPI',
      label: 'Suporte',
      phoneNumber: '5511999999999',
      zapiInstanceId: `instance-${connectionSuffix()}`,
      encryptedZapiToken: 'enc:token',
      createdById: user.id,
    },
  })
  const contact = await prisma.whatsAppContact.create({
    data: { workspaceId: workspace.id, waId: '5511988887777', name: 'Maria' },
  })
  return { workspace, user, connection, contact }
}

let counter = 0
function connectionSuffix() {
  counter += 1
  return counter
}

describe('WhatsAppConversationRepository', () => {
  describe('create() + findById()', () => {
    it('should persist a conversation and include the joined contact', async () => {
      const { workspace, connection, contact } = await seedFixtures()

      const created = expectOk(
        await WhatsAppConversationRepository.create({
          workspaceId: workspace.id,
          connectionId: connection.id,
          contactId: contact.id,
          status: 'NEW',
        }),
      )

      const found = expectOk(
        await WhatsAppConversationRepository.findById(created.id, workspace.id),
      )
      expect(found?.contact.waId).toBe('5511988887777')
      expect(found?.messages).toEqual([])
    })
  })

  describe('findActiveByContact()', () => {
    it('should find a NEW/IN_PROGRESS conversation but ignore CLOSED ones', async () => {
      const { workspace, connection, contact } = await seedFixtures()
      const closed = expectOk(
        await WhatsAppConversationRepository.create({
          workspaceId: workspace.id,
          connectionId: connection.id,
          contactId: contact.id,
          status: 'CLOSED',
        }),
      )

      const noneActive = expectOk(
        await WhatsAppConversationRepository.findActiveByContact(
          workspace.id,
          contact.id,
        ),
      )
      expect(noneActive).toBeNull()

      const active = expectOk(
        await WhatsAppConversationRepository.create({
          workspaceId: workspace.id,
          connectionId: connection.id,
          contactId: contact.id,
          status: 'IN_PROGRESS',
        }),
      )

      const found = expectOk(
        await WhatsAppConversationRepository.findActiveByContact(
          workspace.id,
          contact.id,
        ),
      )
      expect(found?.id).toBe(active.id)
      expect(found?.id).not.toBe(closed.id)
    })

    it('should ignore a deleted conversation that is still open', async () => {
      const { workspace, connection, contact } = await seedFixtures()
      const deleted = expectOk(
        await WhatsAppConversationRepository.create({
          workspaceId: workspace.id,
          connectionId: connection.id,
          contactId: contact.id,
          status: 'IN_PROGRESS',
        }),
      )
      expectOk(
        await WhatsAppConversationRepository.update(deleted.id, {
          deletedAt: new Date(),
        }),
      )

      const found = expectOk(
        await WhatsAppConversationRepository.findActiveByContact(
          workspace.id,
          contact.id,
        ),
      )
      expect(found).toBeNull()
    })
  })

  describe('listByWorkspace()', () => {
    it('should filter by status', async () => {
      const { workspace, connection, contact } = await seedFixtures()
      await WhatsAppConversationRepository.create({
        workspaceId: workspace.id,
        connectionId: connection.id,
        contactId: contact.id,
        status: 'NEW',
      })
      await WhatsAppConversationRepository.create({
        workspaceId: workspace.id,
        connectionId: connection.id,
        contactId: contact.id,
        status: 'CLOSED',
      })

      const result = expectOk(
        await WhatsAppConversationRepository.listByWorkspace(workspace.id, {
          status: 'CLOSED',
        }),
      )

      expect(result).toHaveLength(1)
      expect(result[0].status).toBe('CLOSED')
    })

    it('should exclude soft-deleted conversations by default', async () => {
      const { workspace, connection, contact } = await seedFixtures()
      const active = expectOk(
        await WhatsAppConversationRepository.create({
          workspaceId: workspace.id,
          connectionId: connection.id,
          contactId: contact.id,
        }),
      )
      const deleted = expectOk(
        await WhatsAppConversationRepository.create({
          workspaceId: workspace.id,
          connectionId: connection.id,
          contactId: contact.id,
        }),
      )
      await WhatsAppConversationRepository.update(deleted.id, {
        deletedAt: new Date(),
      })

      const result = expectOk(
        await WhatsAppConversationRepository.listByWorkspace(workspace.id),
      )

      expect(result.map((c) => c.id)).toEqual([active.id])
    })

    it('should only return archived conversations when archived: true', async () => {
      const { workspace, connection, contact } = await seedFixtures()
      const active = expectOk(
        await WhatsAppConversationRepository.create({
          workspaceId: workspace.id,
          connectionId: connection.id,
          contactId: contact.id,
        }),
      )
      const archived = expectOk(
        await WhatsAppConversationRepository.create({
          workspaceId: workspace.id,
          connectionId: connection.id,
          contactId: contact.id,
        }),
      )
      await WhatsAppConversationRepository.update(archived.id, {
        archivedAt: new Date(),
      })

      const activeList = expectOk(
        await WhatsAppConversationRepository.listByWorkspace(workspace.id),
      )
      expect(activeList.map((c) => c.id)).toEqual([active.id])

      const archivedList = expectOk(
        await WhatsAppConversationRepository.listByWorkspace(workspace.id, {
          archived: true,
        }),
      )
      expect(archivedList.map((c) => c.id)).toEqual([archived.id])
    })

    it('should filter by connectionId', async () => {
      const { workspace, connection, contact, user } = await seedFixtures()
      const secondConnection = await prisma.whatsAppConnection.create({
        data: {
          workspaceId: workspace.id,
          provider: 'ZAPI',
          label: 'Vendas',
          phoneNumber: '5511988880000',
          zapiInstanceId: `instance-${connectionSuffix()}`,
          encryptedZapiToken: 'enc:token',
          createdById: user.id,
        },
      })
      const fromFirst = expectOk(
        await WhatsAppConversationRepository.create({
          workspaceId: workspace.id,
          connectionId: connection.id,
          contactId: contact.id,
        }),
      )
      const fromSecond = expectOk(
        await WhatsAppConversationRepository.create({
          workspaceId: workspace.id,
          connectionId: secondConnection.id,
          contactId: contact.id,
        }),
      )

      const filtered = expectOk(
        await WhatsAppConversationRepository.listByWorkspace(workspace.id, {
          connectionId: secondConnection.id,
        }),
      )
      expect(filtered.map((c) => c.id)).toEqual([fromSecond.id])

      const unfiltered = expectOk(
        await WhatsAppConversationRepository.listByWorkspace(workspace.id),
      )
      expect(unfiltered.map((c) => c.id).sort()).toEqual(
        [fromFirst.id, fromSecond.id].sort(),
      )
    })

    it('should sort pinned conversations first', async () => {
      const { workspace, connection, contact } = await seedFixtures()
      const unpinned = expectOk(
        await WhatsAppConversationRepository.create({
          workspaceId: workspace.id,
          connectionId: connection.id,
          contactId: contact.id,
          lastMessageAt: new Date(),
        }),
      )
      const pinned = expectOk(
        await WhatsAppConversationRepository.create({
          workspaceId: workspace.id,
          connectionId: connection.id,
          contactId: contact.id,
        }),
      )
      await WhatsAppConversationRepository.update(pinned.id, {
        pinnedAt: new Date(),
      })

      const result = expectOk(
        await WhatsAppConversationRepository.listByWorkspace(workspace.id),
      )

      expect(result[0].id).toBe(pinned.id)
      expect(result[1].id).toBe(unpinned.id)
    })
  })

  describe('update()', () => {
    it('should support incrementing unreadCount', async () => {
      const { workspace, connection, contact } = await seedFixtures()
      const created = expectOk(
        await WhatsAppConversationRepository.create({
          workspaceId: workspace.id,
          connectionId: connection.id,
          contactId: contact.id,
          unreadCount: 1,
        }),
      )

      const updated = expectOk(
        await WhatsAppConversationRepository.update(created.id, {
          unreadCount: { increment: 1 },
        }),
      )

      expect(updated.unreadCount).toBe(2)
    })
  })

  describe('listByWorkspace() status OPEN', () => {
    it('should return only NEW/IN_PROGRESS conversations', async () => {
      const { workspace, connection, contact } = await seedFixtures()
      for (const status of ['NEW', 'IN_PROGRESS', 'CLOSED'] as const) {
        await WhatsAppConversationRepository.create({
          workspaceId: workspace.id,
          connectionId: connection.id,
          contactId: contact.id,
          status,
        })
      }

      const open = expectOk(
        await WhatsAppConversationRepository.listByWorkspace(workspace.id, {
          status: 'OPEN',
        }),
      )
      expect(open.map((c) => c.status).sort()).toEqual(['IN_PROGRESS', 'NEW'])
    })
  })

  describe('listByWorkspace() queue filters', () => {
    it('should keep only unassigned conversations, optionally of one team', async () => {
      const { workspace, user, connection, contact } = await seedFixtures()
      const team = await prisma.whatsAppTeam.create({
        data: { workspaceId: workspace.id, name: 'Suporte' },
      })
      const base = {
        workspaceId: workspace.id,
        connectionId: connection.id,
        contactId: contact.id,
        status: 'NEW' as const,
      }
      const general = expectOk(
        await WhatsAppConversationRepository.create(base),
      )
      const ofTeam = expectOk(
        await WhatsAppConversationRepository.create({
          ...base,
          teamId: team.id,
        }),
      )
      await WhatsAppConversationRepository.create({
        ...base,
        status: 'IN_PROGRESS',
        assignedUserId: user.id,
        teamId: team.id,
      })

      const queue = expectOk(
        await WhatsAppConversationRepository.listByWorkspace(workspace.id, {
          status: 'OPEN',
          unassigned: true,
        }),
      )
      expect(queue.map((c) => c.id).sort()).toEqual(
        [general.id, ofTeam.id].sort(),
      )

      const teamQueue = expectOk(
        await WhatsAppConversationRepository.listByWorkspace(workspace.id, {
          unassigned: true,
          teamId: team.id,
        }),
      )
      expect(teamQueue.map((c) => c.id)).toEqual([ofTeam.id])
    })
  })

  describe('findLatestClosedByContact()', () => {
    it('should return the closed, non-deleted conversation of the contact', async () => {
      const { workspace, connection, contact } = await seedFixtures()
      await WhatsAppConversationRepository.create({
        workspaceId: workspace.id,
        connectionId: connection.id,
        contactId: contact.id,
        status: 'CLOSED',
        deletedAt: new Date(),
      })
      const closed = expectOk(
        await WhatsAppConversationRepository.create({
          workspaceId: workspace.id,
          connectionId: connection.id,
          contactId: contact.id,
          status: 'CLOSED',
        }),
      )

      const found = expectOk(
        await WhatsAppConversationRepository.findLatestClosedByContact(
          workspace.id,
          contact.id,
        ),
      )
      expect(found?.id).toBe(closed.id)
    })
  })

  describe('listInactiveOpen()', () => {
    it('should list open conversations idle since the cutoff, scoped by workspace', async () => {
      const { workspace, connection, contact } = await seedFixtures()
      const old = new Date('2026-01-01T00:00:00Z')
      const stale = expectOk(
        await WhatsAppConversationRepository.create({
          workspaceId: workspace.id,
          connectionId: connection.id,
          contactId: contact.id,
          status: 'NEW',
          lastMessageAt: old,
        }),
      )
      await WhatsAppConversationRepository.create({
        workspaceId: workspace.id,
        connectionId: connection.id,
        contactId: contact.id,
        status: 'IN_PROGRESS',
        lastMessageAt: new Date(),
      })
      await WhatsAppConversationRepository.create({
        workspaceId: workspace.id,
        connectionId: connection.id,
        contactId: contact.id,
        status: 'CLOSED',
        lastMessageAt: old,
      })
      const cutoff = new Date('2026-06-01T00:00:00Z')

      const scoped = expectOk(
        await WhatsAppConversationRepository.listInactiveOpen({
          cutoff,
          workspaceIds: { in: [workspace.id] },
          limit: 10,
        }),
      )
      expect(scoped.map((c) => c.id)).toEqual([stale.id])

      const excluded = expectOk(
        await WhatsAppConversationRepository.listInactiveOpen({
          cutoff,
          workspaceIds: { notIn: [workspace.id] },
          limit: 10,
        }),
      )
      expect(excluded).toEqual([])
    })

    it('should skip idle conversations the AI is answering', async () => {
      const { workspace, connection, contact } = await seedFixtures()
      await WhatsAppConversationRepository.create({
        workspaceId: workspace.id,
        connectionId: connection.id,
        contactId: contact.id,
        status: 'NEW',
        aiActive: true,
        lastMessageAt: new Date('2026-01-01T00:00:00Z'),
      })

      const idle = expectOk(
        await WhatsAppConversationRepository.listInactiveOpen({
          cutoff: new Date('2026-06-01T00:00:00Z'),
          workspaceIds: { in: [workspace.id] },
          limit: 10,
        }),
      )
      expect(idle).toEqual([])
    })
  })

  describe('claimSentimentAlert()', () => {
    it('should claim once per cooldown window', async () => {
      const { workspace, connection, contact } = await seedFixtures()
      const conversation = expectOk(
        await WhatsAppConversationRepository.create({
          workspaceId: workspace.id,
          connectionId: connection.id,
          contactId: contact.id,
        }),
      )
      const now = new Date('2026-09-18T12:00:00Z')
      const cutoff = new Date('2026-09-18T06:00:00Z')

      expect(
        expectOk(
          await WhatsAppConversationRepository.claimSentimentAlert(
            conversation.id,
            cutoff,
            now,
          ),
        ),
      ).toBe(true)
      expect(
        expectOk(
          await WhatsAppConversationRepository.claimSentimentAlert(
            conversation.id,
            cutoff,
            new Date('2026-09-18T13:00:00Z'),
          ),
        ),
      ).toBe(false)
      // Depois da janela, pode alertar de novo.
      expect(
        expectOk(
          await WhatsAppConversationRepository.claimSentimentAlert(
            conversation.id,
            new Date('2026-09-18T13:00:00Z'),
            new Date('2026-09-18T19:00:00Z'),
          ),
        ),
      ).toBe(true)
    })
  })

  describe('listByWorkspace() assignedUserId', () => {
    it('should return only conversations assigned to the user', async () => {
      const { workspace, user, connection, contact } = await seedFixtures()
      const mine = await prisma.whatsAppConversation.create({
        data: {
          workspaceId: workspace.id,
          connectionId: connection.id,
          contactId: contact.id,
          assignedUserId: user.id,
        },
      })
      await prisma.whatsAppConversation.create({
        data: {
          workspaceId: workspace.id,
          connectionId: connection.id,
          contactId: contact.id,
        },
      })

      const list = expectOk(
        await WhatsAppConversationRepository.listByWorkspace(workspace.id, {
          assignedUserId: user.id,
        }),
      )
      expect(list.map((c) => c.id)).toEqual([mine.id])
    })
  })

  describe('findByIdRaw() / findByIdWithConnection()', () => {
    it('should load the raw row and the row with its connection', async () => {
      const { workspace, connection, contact } = await seedFixtures()
      const conversation = expectOk(
        await WhatsAppConversationRepository.create({
          workspaceId: workspace.id,
          connectionId: connection.id,
          contactId: contact.id,
        }),
      )

      expect(
        expectOk(
          await WhatsAppConversationRepository.findByIdRaw(conversation.id),
        )?.id,
      ).toBe(conversation.id)
      const withConnection = expectOk(
        await WhatsAppConversationRepository.findByIdWithConnection(
          conversation.id,
        ),
      )
      expect(withConnection?.connection.id).toBe(connection.id)
      expect(
        expectOk(await WhatsAppConversationRepository.findByIdRaw('missing')),
      ).toBeNull()
      expect(
        expectOk(
          await WhatsAppConversationRepository.findByIdWithConnection(
            'missing',
          ),
        ),
      ).toBeNull()
    })
  })

  describe('database failures', () => {
    it('should return DATABASE_ERROR for invalid writes', async () => {
      expectErr(
        await WhatsAppConversationRepository.create({
          workspaceId: 'missing',
          connectionId: 'missing',
          contactId: 'missing',
        }),
        'DATABASE_ERROR',
      )
      expectErr(
        await WhatsAppConversationRepository.update('missing', {
          unreadCount: 1,
        }),
        'DATABASE_ERROR',
      )
    })

    it('should return DATABASE_ERROR when reads throw', async () => {
      const conversation = prisma.whatsAppConversation
      vi.spyOn(conversation, 'findMany')
        .mockRejectedValueOnce(new Error('boom'))
        .mockRejectedValueOnce(new Error('boom'))
      vi.spyOn(conversation, 'findFirst')
        .mockRejectedValueOnce(new Error('boom'))
        .mockRejectedValueOnce(new Error('boom'))
        .mockRejectedValueOnce(new Error('boom'))
      vi.spyOn(conversation, 'findUnique')
        .mockRejectedValueOnce(new Error('boom'))
        .mockRejectedValueOnce(new Error('boom'))
      vi.spyOn(conversation, 'updateMany').mockRejectedValueOnce(
        new Error('boom'),
      )

      expectErr(
        await WhatsAppConversationRepository.listByWorkspace('w'),
        'DATABASE_ERROR',
      )
      expectErr(
        await WhatsAppConversationRepository.listInactiveOpen({
          cutoff: new Date(),
          workspaceIds: { in: ['w'] },
          limit: 1,
        }),
        'DATABASE_ERROR',
      )
      expectErr(
        await WhatsAppConversationRepository.findById('c', 'w'),
        'DATABASE_ERROR',
      )
      expectErr(
        await WhatsAppConversationRepository.findActiveByContact('w', 'c'),
        'DATABASE_ERROR',
      )
      expectErr(
        await WhatsAppConversationRepository.findLatestClosedByContact(
          'w',
          'c',
        ),
        'DATABASE_ERROR',
      )
      expectErr(
        await WhatsAppConversationRepository.findByIdRaw('c'),
        'DATABASE_ERROR',
      )
      expectErr(
        await WhatsAppConversationRepository.findByIdWithConnection('c'),
        'DATABASE_ERROR',
      )
      expectErr(
        await WhatsAppConversationRepository.claimSentimentAlert(
          'c',
          new Date(),
          new Date(),
        ),
        'DATABASE_ERROR',
      )
    })
  })
})
