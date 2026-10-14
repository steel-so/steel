import { describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import { createFakeWhatsAppContact } from '@/src/__tests__/factories/whatsapp-contact.factory'
import { createFakeWhatsAppConversationWithPreview } from '@/src/__tests__/factories/whatsapp-conversation.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/services/whatsapp-usage.service', () => ({
  WhatsAppUsageService: {
    assertCanSend: vi.fn(async () => ({ ok: true, value: undefined })),
    record: vi.fn(async () => undefined),
  },
}))
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/whatsapp-connection.repository')
vi.mock('@/src/repositories/whatsapp-contact.repository')
vi.mock('@/src/repositories/whatsapp-conversation.repository')
vi.mock('@/src/lib/whatsapp/realtime', () => ({
  publishWhatsAppEvent: vi.fn(async () => undefined),
}))
vi.mock('@/src/services/whatsapp-notify', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../whatsapp-notify')>()),
  notifyWhatsAppUsers: vi.fn(async () => 1),
}))

import { whatsappConversationLimitReached } from '@/src/errors'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppConversationService } from '../whatsapp-conversation.service'
import { notifyWhatsAppUsers } from '../whatsapp-notify'
import { WhatsAppUsageService } from '../whatsapp-usage.service'

const mockedMembershipRepo = vi.mocked(MembershipRepository)
const mockedConnectionRepo = vi.mocked(WhatsAppConnectionRepository)
const mockedContactRepo = vi.mocked(WhatsAppContactRepository)
const mockedConversationRepo = vi.mocked(WhatsAppConversationRepository)
const mockedUsage = vi.mocked(WhatsAppUsageService)

describe('WhatsAppConversationService', () => {
  describe('list()', () => {
    it('should forward connectionId to the repository filter', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'MEMBER' })),
      )
      mockedConversationRepo.listByWorkspace.mockResolvedValue(ok([]))

      await WhatsAppConversationService.list('u1', 'ws1', {
        connectionId: 'conn1',
      })

      expect(mockedConversationRepo.listByWorkspace).toHaveBeenCalledWith(
        'ws1',
        { connectionId: 'conn1' },
      )
    })

    it('should still work when connectionId is omitted', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'MEMBER' })),
      )
      mockedConversationRepo.listByWorkspace.mockResolvedValue(ok([]))

      const result = await WhatsAppConversationService.list('u1', 'ws1')

      expectOk(result)
      expect(mockedConversationRepo.listByWorkspace).toHaveBeenCalledWith(
        'ws1',
        {},
      )
    })
  })

  describe('start()', () => {
    it('should create a new conversation when the contact has none active', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'MEMBER' })),
      )
      mockedContactRepo.findById.mockResolvedValue(
        ok(createFakeWhatsAppContact({ id: 'contact1' })),
      )
      mockedConnectionRepo.findById.mockResolvedValue(
        ok(createFakeWhatsAppConnection({ id: 'conn1' })),
      )
      mockedConversationRepo.findActiveByContact.mockResolvedValue(ok(null))
      const created = createFakeWhatsAppConversationWithPreview({
        id: 'conv1',
        contactId: 'contact1',
        connectionId: 'conn1',
      })
      mockedConversationRepo.create.mockResolvedValue(ok(created))
      mockedConversationRepo.findById.mockResolvedValue(ok(created))

      const result = await WhatsAppConversationService.start('u1', 'ws1', {
        contactId: 'contact1',
        connectionId: 'conn1',
      })

      const dto = expectOk(result)
      expect(dto.id).toBe('conv1')
      expect(mockedConversationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          contactId: 'contact1',
          connectionId: 'conn1',
          status: 'NEW',
        }),
      )
      expect(mockedUsage.assertCanSend).toHaveBeenCalledWith(
        'ws1',
        'conversations',
      )
      expect(mockedUsage.record).toHaveBeenCalledWith('ws1', 'conversations')
    })

    it('should refuse a new conversation once the monthly limit is reached', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'MEMBER' })),
      )
      mockedContactRepo.findById.mockResolvedValue(
        ok(createFakeWhatsAppContact({ id: 'contact1' })),
      )
      mockedConnectionRepo.findById.mockResolvedValue(
        ok(createFakeWhatsAppConnection({ id: 'conn1' })),
      )
      mockedConversationRepo.findActiveByContact.mockResolvedValue(ok(null))
      mockedUsage.assertCanSend.mockResolvedValueOnce(
        err(whatsappConversationLimitReached(100, 100)),
      )

      expectErr(
        await WhatsAppConversationService.start('u1', 'ws1', {
          contactId: 'contact1',
          connectionId: 'conn1',
        }),
        'WHATSAPP_CONVERSATION_LIMIT_REACHED',
      )
      expect(mockedConversationRepo.create).not.toHaveBeenCalled()
      expect(mockedUsage.record).not.toHaveBeenCalled()
    })

    it('should reuse an already active conversation instead of creating a duplicate', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'MEMBER' })),
      )
      mockedContactRepo.findById.mockResolvedValue(
        ok(createFakeWhatsAppContact({ id: 'contact1' })),
      )
      mockedConnectionRepo.findById.mockResolvedValue(
        ok(createFakeWhatsAppConnection({ id: 'conn1' })),
      )
      const existing = createFakeWhatsAppConversationWithPreview({
        id: 'conv-existing',
        contactId: 'contact1',
      })
      mockedConversationRepo.findActiveByContact.mockResolvedValue(ok(existing))
      mockedConversationRepo.findById.mockResolvedValue(ok(existing))

      const result = await WhatsAppConversationService.start('u1', 'ws1', {
        contactId: 'contact1',
        connectionId: 'conn1',
      })

      const dto = expectOk(result)
      expect(dto.id).toBe('conv-existing')
      expect(mockedConversationRepo.create).not.toHaveBeenCalled()
      // Reusing an active conversation is neither blocked nor counted.
      expect(mockedUsage.assertCanSend).not.toHaveBeenCalled()
      expect(mockedUsage.record).not.toHaveBeenCalled()
    })

    it('should return WHATSAPP_CONTACT_NOT_FOUND for an unknown contact', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'MEMBER' })),
      )
      mockedContactRepo.findById.mockResolvedValue(ok(null))

      const result = await WhatsAppConversationService.start('u1', 'ws1', {
        contactId: 'unknown',
        connectionId: 'conn1',
      })

      expectErr(result, 'WHATSAPP_CONTACT_NOT_FOUND')
      expect(mockedConnectionRepo.findById).not.toHaveBeenCalled()
    })

    it('should return WHATSAPP_CONNECTION_NOT_FOUND for an unknown connection', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'MEMBER' })),
      )
      mockedContactRepo.findById.mockResolvedValue(
        ok(createFakeWhatsAppContact({ id: 'contact1' })),
      )
      mockedConnectionRepo.findById.mockResolvedValue(ok(null))

      const result = await WhatsAppConversationService.start('u1', 'ws1', {
        contactId: 'contact1',
        connectionId: 'unknown',
      })

      expectErr(result, 'WHATSAPP_CONNECTION_NOT_FOUND')
      expect(mockedConversationRepo.create).not.toHaveBeenCalled()
    })
  })

  describe('markRead()', () => {
    it('should reset unreadCount and skip the update when already read', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'MEMBER' })),
      )
      const conversation = createFakeWhatsAppConversationWithPreview({
        id: 'conv1',
        unreadCount: 0,
      })
      mockedConversationRepo.findById.mockResolvedValue(ok(conversation))

      const result = await WhatsAppConversationService.markRead(
        'u1',
        'ws1',
        'conv1',
      )

      expectOk(result)
      expect(mockedConversationRepo.update).not.toHaveBeenCalled()
    })

    it('should zero out unreadCount and persist when there are unread messages', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'MEMBER' })),
      )
      const conversation = createFakeWhatsAppConversationWithPreview({
        id: 'conv1',
        unreadCount: 3,
      })
      mockedConversationRepo.findById.mockResolvedValue(ok(conversation))
      mockedConversationRepo.update.mockResolvedValue(ok(conversation))

      const result = await WhatsAppConversationService.markRead(
        'u1',
        'ws1',
        'conv1',
      )

      expectOk(result)
      expect(mockedConversationRepo.update).toHaveBeenCalledWith('conv1', {
        unreadCount: 0,
      })
    })
  })

  describe('removeFromAi()', () => {
    it('should deactivate the AI and set the handoff flag', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'MEMBER' })),
      )
      const conversation = createFakeWhatsAppConversationWithPreview({
        id: 'conv1',
        aiActive: true,
        aiHandoff: false,
      })
      mockedConversationRepo.findById.mockResolvedValue(ok(conversation))
      mockedConversationRepo.update.mockResolvedValue(ok(conversation))

      const result = await WhatsAppConversationService.removeFromAi(
        'u1',
        'ws1',
        'conv1',
      )

      expectOk(result)
      expect(mockedConversationRepo.update).toHaveBeenCalledWith('conv1', {
        aiActive: false,
        aiHandoff: true,
        status: 'IN_PROGRESS',
      })
    })

    it('should return WHATSAPP_CONVERSATION_NOT_FOUND when missing', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'MEMBER' })),
      )
      mockedConversationRepo.findById.mockResolvedValue(ok(null))

      const result = await WhatsAppConversationService.removeFromAi(
        'u1',
        'ws1',
        'conv1',
      )

      expectErr(result, 'WHATSAPP_CONVERSATION_NOT_FOUND')
    })
  })

  describe('resumeAi()', () => {
    it('should reactivate the AI and clear the handoff flag', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'MEMBER' })),
      )
      const conversation = createFakeWhatsAppConversationWithPreview({
        id: 'conv1',
        aiActive: false,
        aiHandoff: true,
      })
      mockedConversationRepo.findById.mockResolvedValue(ok(conversation))
      mockedConversationRepo.update.mockResolvedValue(ok(conversation))

      const result = await WhatsAppConversationService.resumeAi(
        'u1',
        'ws1',
        'conv1',
      )

      expectOk(result)
      expect(mockedConversationRepo.update).toHaveBeenCalledWith('conv1', {
        aiActive: true,
        aiHandoff: false,
      })
    })

    it('should return WHATSAPP_CONVERSATION_NOT_FOUND when missing', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'MEMBER' })),
      )
      mockedConversationRepo.findById.mockResolvedValue(ok(null))

      const result = await WhatsAppConversationService.resumeAi(
        'u1',
        'ws1',
        'conv1',
      )

      expectErr(result, 'WHATSAPP_CONVERSATION_NOT_FOUND')
    })
  })

  describe('assign()', () => {
    it('should assign the conversation to a valid workspace member', async () => {
      mockedMembershipRepo.findByUserAndWorkspace
        .mockResolvedValueOnce(ok(createFakeMembership({ role: 'MEMBER' })))
        .mockResolvedValueOnce(
          ok(createFakeMembership({ userId: 'u2', role: 'MEMBER' })),
        )
      const conversation = createFakeWhatsAppConversationWithPreview({
        id: 'conv1',
      })
      mockedConversationRepo.findById.mockResolvedValue(ok(conversation))
      mockedConversationRepo.update.mockResolvedValue(ok(conversation))

      const result = await WhatsAppConversationService.assign(
        'u1',
        'ws1',
        'conv1',
        'u2',
      )

      expectOk(result)
      expect(mockedConversationRepo.update).toHaveBeenCalledWith('conv1', {
        assignedUserId: 'u2',
        status: 'IN_PROGRESS',
      })
    })

    it('should reject assigning to a user outside the workspace', async () => {
      mockedMembershipRepo.findByUserAndWorkspace
        .mockResolvedValueOnce(ok(createFakeMembership({ role: 'MEMBER' })))
        .mockResolvedValueOnce(ok(null))
      const conversation = createFakeWhatsAppConversationWithPreview({
        id: 'conv1',
      })
      mockedConversationRepo.findById.mockResolvedValue(ok(conversation))

      const result = await WhatsAppConversationService.assign(
        'u1',
        'ws1',
        'conv1',
        'stranger',
      )

      expectErr(result, 'BAD_REQUEST')
      expect(mockedConversationRepo.update).not.toHaveBeenCalled()
    })

    it('should allow unassigning by passing null', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'MEMBER' })),
      )
      const conversation = createFakeWhatsAppConversationWithPreview({
        id: 'conv1',
      })
      mockedConversationRepo.findById.mockResolvedValue(ok(conversation))
      mockedConversationRepo.update.mockResolvedValue(ok(conversation))

      const result = await WhatsAppConversationService.assign(
        'u1',
        'ws1',
        'conv1',
        null,
      )

      expectOk(result)
      expect(mockedConversationRepo.update).toHaveBeenCalledWith('conv1', {
        assignedUserId: null,
        status: 'IN_PROGRESS',
      })
    })
  })

  describe('setPinned()', () => {
    it('should pin a conversation with a timestamp', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'MEMBER' })),
      )
      const conversation = createFakeWhatsAppConversationWithPreview({
        id: 'conv1',
      })
      mockedConversationRepo.findById.mockResolvedValue(ok(conversation))
      mockedConversationRepo.update.mockResolvedValue(ok(conversation))

      const result = await WhatsAppConversationService.setPinned(
        'u1',
        'ws1',
        'conv1',
        true,
      )

      expectOk(result)
      expect(mockedConversationRepo.update).toHaveBeenCalledWith('conv1', {
        pinnedAt: expect.any(Date),
      })
    })

    it('should unpin a conversation by clearing the timestamp', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'MEMBER' })),
      )
      const conversation = createFakeWhatsAppConversationWithPreview({
        id: 'conv1',
      })
      mockedConversationRepo.findById.mockResolvedValue(ok(conversation))
      mockedConversationRepo.update.mockResolvedValue(ok(conversation))

      const result = await WhatsAppConversationService.setPinned(
        'u1',
        'ws1',
        'conv1',
        false,
      )

      expectOk(result)
      expect(mockedConversationRepo.update).toHaveBeenCalledWith('conv1', {
        pinnedAt: null,
      })
    })

    it('should return WHATSAPP_CONVERSATION_NOT_FOUND when missing', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'MEMBER' })),
      )
      mockedConversationRepo.findById.mockResolvedValue(ok(null))

      const result = await WhatsAppConversationService.setPinned(
        'u1',
        'ws1',
        'conv1',
        true,
      )

      expectErr(result, 'WHATSAPP_CONVERSATION_NOT_FOUND')
      expect(mockedConversationRepo.update).not.toHaveBeenCalled()
    })
  })

  describe('setArchived()', () => {
    it('should archive a conversation with a timestamp', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'MEMBER' })),
      )
      const conversation = createFakeWhatsAppConversationWithPreview({
        id: 'conv1',
      })
      mockedConversationRepo.findById.mockResolvedValue(ok(conversation))
      mockedConversationRepo.update.mockResolvedValue(ok(conversation))

      const result = await WhatsAppConversationService.setArchived(
        'u1',
        'ws1',
        'conv1',
        true,
      )

      expectOk(result)
      expect(mockedConversationRepo.update).toHaveBeenCalledWith('conv1', {
        archivedAt: expect.any(Date),
      })
    })

    it('should unarchive a conversation by clearing the timestamp', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'MEMBER' })),
      )
      const conversation = createFakeWhatsAppConversationWithPreview({
        id: 'conv1',
      })
      mockedConversationRepo.findById.mockResolvedValue(ok(conversation))
      mockedConversationRepo.update.mockResolvedValue(ok(conversation))

      const result = await WhatsAppConversationService.setArchived(
        'u1',
        'ws1',
        'conv1',
        false,
      )

      expectOk(result)
      expect(mockedConversationRepo.update).toHaveBeenCalledWith('conv1', {
        archivedAt: null,
      })
    })
  })

  describe('remove()', () => {
    it('should forbid a MEMBER from deleting a conversation (admin-only)', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'MEMBER' })),
      )

      expectErr(
        await WhatsAppConversationService.remove('u1', 'ws1', 'conv1'),
        'FORBIDDEN',
      )
      expect(mockedConversationRepo.update).not.toHaveBeenCalled()
    })

    it('should soft-delete the conversation', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'ADMIN' })),
      )
      const conversation = createFakeWhatsAppConversationWithPreview({
        id: 'conv1',
      })
      mockedConversationRepo.findById.mockResolvedValue(ok(conversation))
      mockedConversationRepo.update.mockResolvedValue(ok(conversation))

      const result = await WhatsAppConversationService.remove(
        'u1',
        'ws1',
        'conv1',
      )

      const value = expectOk(result)
      expect(value).toEqual({ id: 'conv1' })
      expect(mockedConversationRepo.update).toHaveBeenCalledWith('conv1', {
        deletedAt: expect.any(Date),
      })
    })

    it('should return WHATSAPP_CONVERSATION_NOT_FOUND when missing', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'ADMIN' })),
      )
      mockedConversationRepo.findById.mockResolvedValue(ok(null))

      const result = await WhatsAppConversationService.remove(
        'u1',
        'ws1',
        'conv1',
      )

      expectErr(result, 'WHATSAPP_CONVERSATION_NOT_FOUND')
    })
  })

  describe('clear()', () => {
    it('should set a clearedAt cursor and reset lastMessageAt', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'ADMIN' })),
      )
      const conversation = createFakeWhatsAppConversationWithPreview({
        id: 'conv1',
      })
      mockedConversationRepo.findById.mockResolvedValue(ok(conversation))
      mockedConversationRepo.update.mockResolvedValue(ok(conversation))

      const result = await WhatsAppConversationService.clear(
        'u1',
        'ws1',
        'conv1',
      )

      expectOk(result)
      expect(mockedConversationRepo.update).toHaveBeenCalledWith('conv1', {
        clearedAt: expect.any(Date),
        lastMessageAt: null,
      })
    })
  })
})

describe('WhatsAppConversationService.assign() · notice', () => {
  const notify = vi.mocked(notifyWhatsAppUsers)

  function arrange(currentAssignee: string | null) {
    mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
      ok(createFakeMembership({ role: 'MEMBER' })),
    )
    const conversation = createFakeWhatsAppConversationWithPreview({
      id: 'conv1',
      assignedUserId: currentAssignee,
    })
    mockedConversationRepo.findById.mockResolvedValue(ok(conversation))
    mockedConversationRepo.update.mockResolvedValue(ok(conversation))
    return conversation
  }

  it('tells the new assignee, never the actor', async () => {
    const conversation = arrange(null)
    expectOk(
      await WhatsAppConversationService.assign('u1', 'ws1', 'conv1', 'u2'),
    )
    const [input] = notify.mock.calls[0]
    const contact = conversation.contact
    expect(input).toMatchObject({
      workspaceId: 'ws1',
      kind: 'WHATSAPP_CONVERSATION_ASSIGNED',
      userIds: ['u2'],
      actorId: 'u1',
      title: 'Conversa atribuída a você',
      body: `Conversa com ${contact.name ?? contact.waId}.`,
    })
    expect(input.path).toBe('/zap?conversa=conv1')
  })

  it('falls back to the number when the contact has no name', async () => {
    const conversation = arrange(null)
    mockedConversationRepo.findById.mockResolvedValue(
      ok({
        ...conversation,
        contact: { ...conversation.contact, name: null, waId: '5511900001111' },
      }),
    )
    expectOk(
      await WhatsAppConversationService.assign('u1', 'ws1', 'conv1', 'u2'),
    )
    expect(notify.mock.calls[0][0].body).toBe('Conversa com 5511900001111.')
  })

  it('stays quiet when unassigning or when the assignee did not change', async () => {
    arrange('u2')
    expectOk(
      await WhatsAppConversationService.assign('u1', 'ws1', 'conv1', 'u2'),
    )
    expectOk(
      await WhatsAppConversationService.assign('u1', 'ws1', 'conv1', null),
    )
    expect(notify).not.toHaveBeenCalled()
  })

  it('passes the actor along so a self-assign is filtered out', async () => {
    arrange(null)
    expectOk(
      await WhatsAppConversationService.assign('u1', 'ws1', 'conv1', 'u1'),
    )
    expect(notify.mock.calls[0][0]).toMatchObject({
      userIds: ['u1'],
      actorId: 'u1',
    })
  })
})
