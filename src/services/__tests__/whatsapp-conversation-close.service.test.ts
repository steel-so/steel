import { describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeWhatsAppCloseStatus } from '@/src/__tests__/factories/whatsapp-close-status.factory'
import {
  createFakeWhatsAppConversation,
  createFakeWhatsAppConversationWithPreview,
} from '@/src/__tests__/factories/whatsapp-conversation.factory'
import { createFakeWhatsAppSettings } from '@/src/__tests__/factories/whatsapp-settings.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { ok } from '@/src/lib/result'

// Fire-and-forget webhook: the real emitter would outlive the test.
vi.mock('@/src/services/whatsapp-conversation-waiting', () => ({
  emitWhatsAppConversationWaiting: vi.fn(),
}))
vi.mock('@/src/services/whatsapp-usage.service', () => ({
  WhatsAppUsageService: {
    assertCanSend: vi.fn(async () => ({ ok: true, value: undefined })),
    record: vi.fn(async () => undefined),
  },
}))
vi.mock('@/src/repositories/whatsapp-close-status.repository', () => ({
  WhatsAppCloseStatusRepository: {
    listActive: vi.fn(async () => ({ ok: true, value: [] })),
  },
}))
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/whatsapp-conversation.repository')
vi.mock('@/src/repositories/whatsapp-conversation-event.repository')
vi.mock('@/src/repositories/whatsapp-settings.repository')
vi.mock('@/src/lib/whatsapp/realtime', () => ({
  publishWhatsAppEvent: vi.fn(async () => undefined),
}))
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))

import type { WhatsAppConversationEvent } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { whatsappConversationLimitReached } from '@/src/errors'
import { err } from '@/src/lib/result'
import { publishWhatsAppEvent } from '@/src/lib/whatsapp/realtime'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WhatsAppCloseStatusRepository } from '@/src/repositories/whatsapp-close-status.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppConversationEventRepository } from '@/src/repositories/whatsapp-conversation-event.repository'
import { WhatsAppSettingsRepository } from '@/src/repositories/whatsapp-settings.repository'
import { WhatsAppConversationService } from '../whatsapp-conversation.service'
import { emitWhatsAppConversationWaiting } from '../whatsapp-conversation-waiting'
import { WhatsAppUsageService } from '../whatsapp-usage.service'

const mockedMembershipRepo = vi.mocked(MembershipRepository)
const mockedConversationRepo = vi.mocked(WhatsAppConversationRepository)
const mockedEventRepo = vi.mocked(WhatsAppConversationEventRepository)
const mockedSettingsRepo = vi.mocked(WhatsAppSettingsRepository)
const mockedUsage = vi.mocked(WhatsAppUsageService)

function fakeEvent(
  overrides: Partial<WhatsAppConversationEvent> = {},
): WhatsAppConversationEvent {
  return {
    id: 'ev1',
    workspaceId: 'ws1',
    conversationId: 'conv1',
    kind: 'CLOSED',
    source: 'AGENT',
    actorUserId: 'u1',
    reason: null,
    closeOutcome: null,
    closeStatusLabels: [],
    createdAt: new Date('2026-09-18T12:00:00Z'),
    ...overrides,
  }
}

function asRole(role: 'MEMBER' | 'VIEWER' | 'ADMIN') {
  mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )
}

function arrangeConversation(
  overrides: Parameters<typeof createFakeWhatsAppConversationWithPreview>[0],
) {
  const conversation = createFakeWhatsAppConversationWithPreview({
    id: 'conv1',
    workspaceId: 'ws1',
    ...overrides,
  })
  mockedConversationRepo.findById.mockResolvedValue(ok(conversation))
  mockedConversationRepo.update.mockResolvedValue(ok(conversation))
  mockedEventRepo.create.mockResolvedValue(ok(fakeEvent()))
  return conversation
}

describe('WhatsAppConversationService.close()', () => {
  it('should close an open conversation with the reason, timeline event and audit', async () => {
    asRole('MEMBER')
    arrangeConversation({ status: 'IN_PROGRESS' })

    expectOk(
      await WhatsAppConversationService.close('u1', 'ws1', 'conv1', {
        reason: 'Resolvido',
      }),
    )

    expect(mockedConversationRepo.update).toHaveBeenCalledWith('conv1', {
      status: 'CLOSED',
      closedAt: expect.any(Date),
      closeReason: 'Resolvido',
      closeOutcome: null,
      closeStatusIds: [],
      closeStatusLabels: [],
    })
    expect(mockedEventRepo.create).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      conversationId: 'conv1',
      kind: 'CLOSED',
      source: 'AGENT',
      actorUserId: 'u1',
      reason: 'Resolvido',
      closeOutcome: null,
      closeStatusLabels: [],
    })
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'whatsapp_conversation',
        action: 'close',
        actorId: 'u1',
        targetId: 'conv1',
      }),
    )
    expect(publishWhatsAppEvent).toHaveBeenCalledWith(
      'ws1',
      expect.objectContaining({ type: 'conversation.updated' }),
    )
  })

  it('should return WHATSAPP_CONVERSATION_ALREADY_CLOSED for a closed conversation', async () => {
    asRole('MEMBER')
    arrangeConversation({ status: 'CLOSED' })

    expectErr(
      await WhatsAppConversationService.close('u1', 'ws1', 'conv1', {}),
      'WHATSAPP_CONVERSATION_ALREADY_CLOSED',
    )
    expect(mockedConversationRepo.update).not.toHaveBeenCalled()
  })

  it('should forbid a VIEWER (no conversations EDIT permission)', async () => {
    asRole('VIEWER')

    expectErr(
      await WhatsAppConversationService.close('u1', 'ws1', 'conv1', {}),
      'FORBIDDEN',
    )
  })

  it('should forbid a non-member', async () => {
    mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))

    expectErr(
      await WhatsAppConversationService.close('intruder', 'ws1', 'conv1', {}),
      'FORBIDDEN',
    )
  })

  it('should return WHATSAPP_CONVERSATION_NOT_FOUND for an unknown conversation', async () => {
    asRole('MEMBER')
    mockedConversationRepo.findById.mockResolvedValue(ok(null))

    expectErr(
      await WhatsAppConversationService.close('u1', 'ws1', 'nope', {}),
      'WHATSAPP_CONVERSATION_NOT_FOUND',
    )
  })
})

describe('WhatsAppConversationService.close() with close statuses', () => {
  it('should store the classification on the conversation and the timeline', async () => {
    asRole('MEMBER')
    arrangeConversation({ status: 'IN_PROGRESS' })
    vi.mocked(WhatsAppCloseStatusRepository.listActive).mockResolvedValueOnce(
      ok([
        createFakeWhatsAppCloseStatus({
          id: 's1',
          label: 'Sem interesse',
          outcome: 'FAILURE',
        }),
      ]),
    )
    mockedSettingsRepo.findByWorkspace.mockResolvedValue(
      ok(createFakeWhatsAppSettings({ closeStatusMinSelections: 1 })),
    )

    expectOk(
      await WhatsAppConversationService.close('u1', 'ws1', 'conv1', {
        statusIds: ['s1'],
      }),
    )

    expect(mockedConversationRepo.update).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({
        status: 'CLOSED',
        closeOutcome: 'FAILURE',
        closeStatusIds: ['s1'],
        closeStatusLabels: ['Sem interesse'],
      }),
    )
    expect(mockedEventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'CLOSED',
        closeOutcome: 'FAILURE',
        closeStatusLabels: ['Sem interesse'],
      }),
    )
  })

  it('should refuse to close without the required statuses', async () => {
    asRole('MEMBER')
    arrangeConversation({ status: 'IN_PROGRESS' })
    vi.mocked(WhatsAppCloseStatusRepository.listActive).mockResolvedValueOnce(
      ok([createFakeWhatsAppCloseStatus({ id: 's1' })]),
    )
    mockedSettingsRepo.findByWorkspace.mockResolvedValue(
      ok(createFakeWhatsAppSettings({ closeStatusMinSelections: 1 })),
    )

    expectErr(
      await WhatsAppConversationService.close('u1', 'ws1', 'conv1', {}),
      'WHATSAPP_CLOSE_STATUS_SELECTION_INVALID',
    )
    expect(mockedConversationRepo.update).not.toHaveBeenCalled()
  })
})

describe('WhatsAppConversationService.reopen()', () => {
  it('should reopen as IN_PROGRESS when the conversation has an assignee', async () => {
    asRole('MEMBER')
    // The member's own conversation — a scoped member sees it (Equipes).
    arrangeConversation({ status: 'CLOSED', assignedUserId: 'u1' })

    expectOk(await WhatsAppConversationService.reopen('u1', 'ws1', 'conv1'))

    expect(mockedConversationRepo.update).toHaveBeenCalledWith('conv1', {
      status: 'IN_PROGRESS',
      closedAt: null,
      closeReason: null,
      closeOutcome: null,
      closeStatusIds: [],
      closeStatusLabels: [],
    })
    expect(mockedEventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'REOPENED',
        source: 'AGENT',
        actorUserId: 'u1',
      }),
    )
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'reopen', actorId: 'u1' }),
    )
    expect(mockedUsage.assertCanSend).toHaveBeenCalledWith(
      'ws1',
      'conversations',
    )
    expect(mockedUsage.record).toHaveBeenCalledWith('ws1', 'conversations')
    // Someone already serves it: it does not enter the queue.
    expect(emitWhatsAppConversationWaiting).not.toHaveBeenCalled()
  })

  it('should refuse to reopen once the monthly conversation limit is reached', async () => {
    asRole('MEMBER')
    // The member's own conversation — a scoped member sees it (Equipes).
    arrangeConversation({ status: 'CLOSED', assignedUserId: 'u1' })
    mockedUsage.assertCanSend.mockResolvedValueOnce(
      err(whatsappConversationLimitReached(10, 10)),
    )

    expectErr(
      await WhatsAppConversationService.reopen('u1', 'ws1', 'conv1'),
      'WHATSAPP_CONVERSATION_LIMIT_REACHED',
    )
    expect(mockedConversationRepo.update).not.toHaveBeenCalled()
    expect(mockedUsage.record).not.toHaveBeenCalled()
  })

  it('should reopen as NEW when nobody is assigned and announce it waits', async () => {
    asRole('MEMBER')
    const conversation = arrangeConversation({
      status: 'CLOSED',
      assignedUserId: null,
    })

    expectOk(await WhatsAppConversationService.reopen('u1', 'ws1', 'conv1'))

    expect(mockedConversationRepo.update).toHaveBeenCalledWith(
      'conv1',
      expect.objectContaining({ status: 'NEW' }),
    )
    expect(emitWhatsAppConversationWaiting).toHaveBeenCalledWith({
      conversation,
      contact: conversation.contact,
      reason: 'reopened',
      actorId: 'u1',
    })
  })

  it('should return WHATSAPP_CONVERSATION_NOT_CLOSED for an open conversation', async () => {
    asRole('MEMBER')
    arrangeConversation({ status: 'NEW' })

    expectErr(
      await WhatsAppConversationService.reopen('u1', 'ws1', 'conv1'),
      'WHATSAPP_CONVERSATION_NOT_CLOSED',
    )
  })
})

describe('WhatsAppConversationService.listEvents()', () => {
  it('should map the timeline with the actor name', async () => {
    asRole('VIEWER')
    mockedEventRepo.listByConversation.mockResolvedValue(
      ok([
        {
          ...fakeEvent({ reason: 'Sem retorno' }),
          actorUser: { id: 'u1', name: 'Ana' },
        },
      ]),
    )

    const events = expectOk(
      await WhatsAppConversationService.listEvents('u1', 'ws1', 'conv1'),
    )

    expect(events).toEqual([
      {
        id: 'ev1',
        conversationId: 'conv1',
        kind: 'CLOSED',
        source: 'AGENT',
        actorUserId: 'u1',
        actorName: 'Ana',
        reason: 'Sem retorno',
        closeOutcome: null,
        closeStatusLabels: [],
        createdAt: '2026-09-18T12:00:00.000Z',
      },
    ])
    expect(mockedEventRepo.listByConversation).toHaveBeenCalledWith(
      'conv1',
      'ws1',
    )
  })
})

describe('WhatsAppConversationService.closeInactive()', () => {
  const now = new Date('2026-09-18T12:00:00Z')

  it('should use the 24h default for workspaces without settings and the saved window otherwise', async () => {
    mockedSettingsRepo.listAll.mockResolvedValue(
      ok([
        createFakeWhatsAppSettings({
          workspaceId: 'wsCustom',
          autoCloseAfterHours: 2,
        }),
        createFakeWhatsAppSettings({
          workspaceId: 'wsOff',
          autoCloseAfterHours: 0,
        }),
      ]),
    )
    mockedConversationRepo.listInactiveOpen.mockResolvedValue(ok([]))

    expectOk(await WhatsAppConversationService.closeInactive(now))

    expect(mockedConversationRepo.listInactiveOpen).toHaveBeenCalledTimes(2)
    expect(mockedConversationRepo.listInactiveOpen).toHaveBeenCalledWith({
      cutoff: new Date('2026-09-17T12:00:00Z'),
      workspaceIds: { notIn: ['wsCustom', 'wsOff'] },
      limit: 500,
    })
    expect(mockedConversationRepo.listInactiveOpen).toHaveBeenCalledWith({
      cutoff: new Date('2026-09-18T10:00:00Z'),
      workspaceIds: { in: ['wsCustom'] },
      limit: 500,
    })
  })

  it('should close each inactive conversation as a system action', async () => {
    mockedSettingsRepo.listAll.mockResolvedValue(ok([]))
    const stale = createFakeWhatsAppConversation({
      id: 'stale1',
      workspaceId: 'ws1',
      status: 'NEW',
    })
    mockedConversationRepo.listInactiveOpen.mockResolvedValue(ok([stale]))
    mockedConversationRepo.update.mockResolvedValue(ok(stale))
    mockedEventRepo.create.mockResolvedValue(ok(fakeEvent()))
    mockedConversationRepo.findById.mockResolvedValue(
      ok(createFakeWhatsAppConversationWithPreview({ id: 'stale1' })),
    )

    const result = expectOk(
      await WhatsAppConversationService.closeInactive(now),
    )

    expect(result).toEqual({ closed: 1 })
    expect(mockedEventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'stale1',
        kind: 'CLOSED',
        source: 'INACTIVITY',
        actorUserId: null,
      }),
    )
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'close',
        actorId: null,
        meta: expect.objectContaining({ actor: 'system' }),
      }),
    )
  })
})
