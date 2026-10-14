import type { WhatsAppConversationEvent } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeUser } from '@/src/__tests__/factories/user.factory'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import { createFakeWhatsAppContact } from '@/src/__tests__/factories/whatsapp-contact.factory'
import {
  createFakeWhatsAppConversation,
  createFakeWhatsAppConversationWithPreview,
} from '@/src/__tests__/factories/whatsapp-conversation.factory'
import { createFakeWhatsAppSettings } from '@/src/__tests__/factories/whatsapp-settings.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import type { AppError } from '@/src/errors/app-error'
import { err, ok, type Result } from '@/src/lib/result'

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
vi.mock('@/src/repositories/whatsapp-conversation-event.repository')
vi.mock('@/src/repositories/whatsapp-settings.repository')
vi.mock('@/src/lib/whatsapp/realtime', () => ({
  publishWhatsAppEvent: vi.fn(async () => undefined),
}))
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

import { logger } from '@/lib/axiom/logger'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppConversationEventRepository } from '@/src/repositories/whatsapp-conversation-event.repository'
import { WhatsAppSettingsRepository } from '@/src/repositories/whatsapp-settings.repository'
import {
  reopenWhatsAppConversation,
  WhatsAppConversationService,
} from '../whatsapp-conversation.service'

const mockedMembershipRepo = vi.mocked(MembershipRepository)
const mockedConnectionRepo = vi.mocked(WhatsAppConnectionRepository)
const mockedContactRepo = vi.mocked(WhatsAppContactRepository)
const mockedConversationRepo = vi.mocked(WhatsAppConversationRepository)
const mockedEventRepo = vi.mocked(WhatsAppConversationEventRepository)
const mockedSettingsRepo = vi.mocked(WhatsAppSettingsRepository)

const DB_ERROR: AppError = { code: 'DATABASE_ERROR', message: 'db down' }

function fakeEvent(): WhatsAppConversationEvent {
  return {
    id: 'ev1',
    workspaceId: 'ws1',
    conversationId: 'conv1',
    kind: 'CLOSED',
    source: 'AGENT',
    actorUserId: 'u1',
    reason: null,
    createdAt: new Date('2026-09-18T12:00:00Z'),
  }
}

function asAdmin() {
  mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role: 'ADMIN' })),
  )
}

function asNonMember() {
  mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))
}

function conversation(
  overrides: Parameters<
    typeof createFakeWhatsAppConversationWithPreview
  >[0] = {},
) {
  return createFakeWhatsAppConversationWithPreview({
    id: 'conv1',
    workspaceId: 'ws1',
    unreadCount: 2,
    ...overrides,
  })
}

type Call = () => Promise<Result<unknown>>

/**
 * Mutações que seguem o mesmo roteiro: membership → findById → update →
 * findById (DTO fresco) → publish. Cada falha intermediária deve propagar.
 */
const refetchingMutations: [string, Call][] = [
  [
    'markRead',
    () => WhatsAppConversationService.markRead('u1', 'ws1', 'conv1'),
  ],
  [
    'removeFromAi',
    () => WhatsAppConversationService.removeFromAi('u1', 'ws1', 'conv1'),
  ],
  [
    'resumeAi',
    () => WhatsAppConversationService.resumeAi('u1', 'ws1', 'conv1'),
  ],
  [
    'setPinned',
    () => WhatsAppConversationService.setPinned('u1', 'ws1', 'conv1', true),
  ],
  [
    'setArchived',
    () => WhatsAppConversationService.setArchived('u1', 'ws1', 'conv1', true),
  ],
  ['clear', () => WhatsAppConversationService.clear('u1', 'ws1', 'conv1')],
  [
    'assign',
    () => WhatsAppConversationService.assign('u1', 'ws1', 'conv1', null),
  ],
]

describe.each(refetchingMutations)(
  'WhatsAppConversationService.%s() failures',
  (_name, call) => {
    it('should return FORBIDDEN for a non-member', async () => {
      asNonMember()

      expectErr(await call(), 'FORBIDDEN')
      expect(mockedConversationRepo.findById).not.toHaveBeenCalled()
    })

    it('should propagate a lookup failure', async () => {
      asAdmin()
      mockedConversationRepo.findById.mockResolvedValue(err(DB_ERROR))

      expectErr(await call(), 'DATABASE_ERROR')
      expect(mockedConversationRepo.update).not.toHaveBeenCalled()
    })

    it('should return WHATSAPP_CONVERSATION_NOT_FOUND when missing', async () => {
      asAdmin()
      mockedConversationRepo.findById.mockResolvedValue(ok(null))

      expectErr(await call(), 'WHATSAPP_CONVERSATION_NOT_FOUND')
    })

    it('should propagate an update failure', async () => {
      asAdmin()
      mockedConversationRepo.findById.mockResolvedValue(ok(conversation()))
      mockedConversationRepo.update.mockResolvedValue(err(DB_ERROR))

      expectErr(await call(), 'DATABASE_ERROR')
    })

    it('should propagate a failure when reloading the updated conversation', async () => {
      asAdmin()
      mockedConversationRepo.findById
        .mockResolvedValueOnce(ok(conversation()))
        .mockResolvedValueOnce(err(DB_ERROR))
      mockedConversationRepo.update.mockResolvedValue(ok(conversation()))

      expectErr(await call(), 'DATABASE_ERROR')
    })

    it('should return WHATSAPP_CONVERSATION_NOT_FOUND when it vanished after the update', async () => {
      asAdmin()
      mockedConversationRepo.findById
        .mockResolvedValueOnce(ok(conversation()))
        .mockResolvedValueOnce(ok(null))
      mockedConversationRepo.update.mockResolvedValue(ok(conversation()))

      expectErr(await call(), 'WHATSAPP_CONVERSATION_NOT_FOUND')
    })
  },
)

describe('WhatsAppConversationService read failures', () => {
  it('list() should return FORBIDDEN for a non-member', async () => {
    asNonMember()

    expectErr(await WhatsAppConversationService.list('u1', 'ws1'), 'FORBIDDEN')
  })

  it('list() should propagate a repository failure', async () => {
    asAdmin()
    mockedConversationRepo.listByWorkspace.mockResolvedValue(err(DB_ERROR))

    expectErr(
      await WhatsAppConversationService.list('u1', 'ws1'),
      'DATABASE_ERROR',
    )
  })

  it('get() should return the conversation DTO', async () => {
    asAdmin()
    mockedConversationRepo.findById.mockResolvedValue(ok(conversation()))

    const dto = expectOk(
      await WhatsAppConversationService.get('u1', 'ws1', 'conv1'),
    )

    expect(dto.id).toBe('conv1')
    expect(mockedConversationRepo.findById).toHaveBeenCalledWith('conv1', 'ws1')
  })

  it('get() should return FORBIDDEN for a non-member', async () => {
    asNonMember()

    expectErr(
      await WhatsAppConversationService.get('u1', 'ws1', 'conv1'),
      'FORBIDDEN',
    )
  })

  it('get() should propagate a repository failure', async () => {
    asAdmin()
    mockedConversationRepo.findById.mockResolvedValue(err(DB_ERROR))

    expectErr(
      await WhatsAppConversationService.get('u1', 'ws1', 'conv1'),
      'DATABASE_ERROR',
    )
  })

  it('get() should return WHATSAPP_CONVERSATION_NOT_FOUND when missing', async () => {
    asAdmin()
    mockedConversationRepo.findById.mockResolvedValue(ok(null))

    expectErr(
      await WhatsAppConversationService.get('u1', 'ws1', 'conv1'),
      'WHATSAPP_CONVERSATION_NOT_FOUND',
    )
  })

  it('listEvents() should return FORBIDDEN for a non-member', async () => {
    asNonMember()

    expectErr(
      await WhatsAppConversationService.listEvents('u1', 'ws1', 'conv1'),
      'FORBIDDEN',
    )
  })

  it('listEvents() should propagate a repository failure', async () => {
    asAdmin()
    mockedEventRepo.listByConversation.mockResolvedValue(err(DB_ERROR))

    expectErr(
      await WhatsAppConversationService.listEvents('u1', 'ws1', 'conv1'),
      'DATABASE_ERROR',
    )
  })
})

describe('WhatsAppConversationService.listAssignableMembers()', () => {
  it('should map workspace members to assignable users', async () => {
    asAdmin()
    const user = createFakeUser({
      id: 'u2',
      name: 'Ana',
      email: 'ana@example.com',
      image: null,
    })
    mockedMembershipRepo.listWithUserByWorkspace.mockResolvedValue(
      ok([{ ...createFakeMembership({ userId: 'u2' }), user }] as never),
    )

    const members = expectOk(
      await WhatsAppConversationService.listAssignableMembers('u1', 'ws1'),
    )

    expect(members).toEqual([
      { id: 'u2', name: 'Ana', email: 'ana@example.com', image: null },
    ])
  })

  it('should return FORBIDDEN for a non-member', async () => {
    asNonMember()

    expectErr(
      await WhatsAppConversationService.listAssignableMembers('u1', 'ws1'),
      'FORBIDDEN',
    )
  })

  it('should propagate a repository failure', async () => {
    asAdmin()
    mockedMembershipRepo.listWithUserByWorkspace.mockResolvedValue(
      err(DB_ERROR),
    )

    expectErr(
      await WhatsAppConversationService.listAssignableMembers('u1', 'ws1'),
      'DATABASE_ERROR',
    )
  })
})

describe('WhatsAppConversationService.start() failures', () => {
  const dto = { contactId: 'ct1', connectionId: 'cn1' }

  function arrangeLookups() {
    asAdmin()
    mockedContactRepo.findById.mockResolvedValue(
      ok(createFakeWhatsAppContact({ id: 'ct1' })),
    )
    mockedConnectionRepo.findById.mockResolvedValue(
      ok(createFakeWhatsAppConnection({ id: 'cn1' })),
    )
    mockedConversationRepo.findActiveByContact.mockResolvedValue(ok(null))
    mockedConversationRepo.create.mockResolvedValue(
      ok(createFakeWhatsAppConversation({ id: 'conv1' })),
    )
  }

  it('should return FORBIDDEN for a non-member', async () => {
    asNonMember()

    expectErr(
      await WhatsAppConversationService.start('u1', 'ws1', dto),
      'FORBIDDEN',
    )
  })

  it('should propagate a contact lookup failure', async () => {
    arrangeLookups()
    mockedContactRepo.findById.mockResolvedValue(err(DB_ERROR))

    expectErr(
      await WhatsAppConversationService.start('u1', 'ws1', dto),
      'DATABASE_ERROR',
    )
  })

  it('should propagate a connection lookup failure', async () => {
    arrangeLookups()
    mockedConnectionRepo.findById.mockResolvedValue(err(DB_ERROR))

    expectErr(
      await WhatsAppConversationService.start('u1', 'ws1', dto),
      'DATABASE_ERROR',
    )
  })

  it('should propagate a failure looking for the active conversation', async () => {
    arrangeLookups()
    mockedConversationRepo.findActiveByContact.mockResolvedValue(err(DB_ERROR))

    expectErr(
      await WhatsAppConversationService.start('u1', 'ws1', dto),
      'DATABASE_ERROR',
    )
  })

  it('should propagate a create failure', async () => {
    arrangeLookups()
    mockedConversationRepo.create.mockResolvedValue(err(DB_ERROR))

    expectErr(
      await WhatsAppConversationService.start('u1', 'ws1', dto),
      'DATABASE_ERROR',
    )
  })

  it('should propagate a failure reloading the created conversation', async () => {
    arrangeLookups()
    mockedConversationRepo.findById.mockResolvedValue(err(DB_ERROR))

    expectErr(
      await WhatsAppConversationService.start('u1', 'ws1', dto),
      'DATABASE_ERROR',
    )
  })

  it('should return WHATSAPP_CONVERSATION_NOT_FOUND when the reload finds nothing', async () => {
    arrangeLookups()
    mockedConversationRepo.findById.mockResolvedValue(ok(null))

    expectErr(
      await WhatsAppConversationService.start('u1', 'ws1', dto),
      'WHATSAPP_CONVERSATION_NOT_FOUND',
    )
  })
})

describe('WhatsAppConversationService.remove() failures', () => {
  it('should propagate a lookup failure', async () => {
    asAdmin()
    mockedConversationRepo.findById.mockResolvedValue(err(DB_ERROR))

    expectErr(
      await WhatsAppConversationService.remove('u1', 'ws1', 'conv1'),
      'DATABASE_ERROR',
    )
  })

  it('should propagate the soft-delete failure', async () => {
    asAdmin()
    mockedConversationRepo.findById.mockResolvedValue(ok(conversation()))
    mockedConversationRepo.update.mockResolvedValue(err(DB_ERROR))

    expectErr(
      await WhatsAppConversationService.remove('u1', 'ws1', 'conv1'),
      'DATABASE_ERROR',
    )
  })
})

describe('WhatsAppConversationService.close()/reopen() failures', () => {
  it.each([
    [
      'close',
      () => WhatsAppConversationService.close('u1', 'ws1', 'conv1', {}),
    ],
    ['reopen', () => WhatsAppConversationService.reopen('u1', 'ws1', 'conv1')],
  ] as [string, Call][])(
    '%s() should return FORBIDDEN for a non-member',
    async (_n, call) => {
      asNonMember()

      expectErr(await call(), 'FORBIDDEN')
    },
  )

  it.each([
    [
      'close',
      () => WhatsAppConversationService.close('u1', 'ws1', 'conv1', {}),
    ],
    ['reopen', () => WhatsAppConversationService.reopen('u1', 'ws1', 'conv1')],
  ] as [string, Call][])(
    '%s() should propagate a lookup failure',
    async (_n, call) => {
      asAdmin()
      mockedConversationRepo.findById.mockResolvedValue(err(DB_ERROR))

      expectErr(await call(), 'DATABASE_ERROR')
    },
  )

  it('reopen() should return WHATSAPP_CONVERSATION_NOT_FOUND for a deleted conversation', async () => {
    asAdmin()
    mockedConversationRepo.findById.mockResolvedValue(
      ok(conversation({ status: 'CLOSED', deletedAt: new Date() })),
    )

    expectErr(
      await WhatsAppConversationService.reopen('u1', 'ws1', 'conv1'),
      'WHATSAPP_CONVERSATION_NOT_FOUND',
    )
  })

  it('close() should propagate an update failure without recording the event', async () => {
    asAdmin()
    mockedConversationRepo.findById.mockResolvedValue(
      ok(conversation({ status: 'IN_PROGRESS' })),
    )
    mockedConversationRepo.update.mockResolvedValue(err(DB_ERROR))

    expectErr(
      await WhatsAppConversationService.close('u1', 'ws1', 'conv1', {}),
      'DATABASE_ERROR',
    )
    expect(mockedEventRepo.create).not.toHaveBeenCalled()
  })

  it('close() should propagate a timeline event failure', async () => {
    asAdmin()
    mockedConversationRepo.findById.mockResolvedValue(
      ok(conversation({ status: 'IN_PROGRESS' })),
    )
    mockedConversationRepo.update.mockResolvedValue(ok(conversation()))
    mockedEventRepo.create.mockResolvedValue(err(DB_ERROR))

    expectErr(
      await WhatsAppConversationService.close('u1', 'ws1', 'conv1', {}),
      'DATABASE_ERROR',
    )
  })

  it('close() should propagate a failure reloading the closed conversation', async () => {
    asAdmin()
    mockedConversationRepo.findById
      .mockResolvedValueOnce(ok(conversation({ status: 'IN_PROGRESS' })))
      .mockResolvedValueOnce(err(DB_ERROR))
    mockedConversationRepo.update.mockResolvedValue(ok(conversation()))
    mockedEventRepo.create.mockResolvedValue(ok(fakeEvent()))

    expectErr(
      await WhatsAppConversationService.close('u1', 'ws1', 'conv1', {}),
      'DATABASE_ERROR',
    )
  })

  it('close() should return WHATSAPP_CONVERSATION_NOT_FOUND when the reload finds nothing', async () => {
    asAdmin()
    mockedConversationRepo.findById
      .mockResolvedValueOnce(ok(conversation({ status: 'IN_PROGRESS' })))
      .mockResolvedValueOnce(ok(null))
    mockedConversationRepo.update.mockResolvedValue(ok(conversation()))
    mockedEventRepo.create.mockResolvedValue(ok(fakeEvent()))

    expectErr(
      await WhatsAppConversationService.close('u1', 'ws1', 'conv1', {}),
      'WHATSAPP_CONVERSATION_NOT_FOUND',
    )
  })

  it('reopen() should propagate an update failure', async () => {
    asAdmin()
    mockedConversationRepo.findById.mockResolvedValue(
      ok(conversation({ status: 'CLOSED' })),
    )
    mockedConversationRepo.update.mockResolvedValue(err(DB_ERROR))

    expectErr(
      await WhatsAppConversationService.reopen('u1', 'ws1', 'conv1'),
      'DATABASE_ERROR',
    )
  })
})

describe('reopenWhatsAppConversation()', () => {
  it('should propagate a timeline event failure', async () => {
    const closed = createFakeWhatsAppConversation({
      id: 'conv1',
      status: 'CLOSED',
    })
    mockedConversationRepo.update.mockResolvedValue(ok(closed))
    mockedEventRepo.create.mockResolvedValue(err(DB_ERROR))

    expectErr(
      await reopenWhatsAppConversation(closed, {
        actorUserId: null,
        source: 'CONTACT',
      }),
      'DATABASE_ERROR',
    )
  })

  it('should reopen as IN_PROGRESS for an assigned conversation and audit the system actor', async () => {
    const closed = createFakeWhatsAppConversation({
      id: 'conv1',
      status: 'CLOSED',
      assignedUserId: 'u2',
    })
    mockedConversationRepo.update.mockResolvedValue(
      ok({ ...closed, status: 'IN_PROGRESS' }),
    )
    mockedEventRepo.create.mockResolvedValue(ok(fakeEvent()))

    const reopened = expectOk(
      await reopenWhatsAppConversation(closed, {
        actorUserId: null,
        source: 'CONTACT',
        extra: { aiActive: true },
      }),
    )

    expect(reopened.status).toBe('IN_PROGRESS')
    expect(mockedConversationRepo.update).toHaveBeenCalledWith('conv1', {
      aiActive: true,
      status: 'IN_PROGRESS',
      closedAt: null,
      closeReason: null,
    })
  })
})

describe('WhatsAppConversationService.closeInactive() failures', () => {
  const now = new Date('2026-09-18T12:00:00Z')

  it('should propagate a settings lookup failure', async () => {
    mockedSettingsRepo.listAll.mockResolvedValue(err(DB_ERROR))

    expectErr(
      await WhatsAppConversationService.closeInactive(now),
      'DATABASE_ERROR',
    )
    expect(mockedConversationRepo.listInactiveOpen).not.toHaveBeenCalled()
  })

  it('should propagate a failure listing inactive conversations', async () => {
    mockedSettingsRepo.listAll.mockResolvedValue(ok([]))
    mockedConversationRepo.listInactiveOpen.mockResolvedValue(err(DB_ERROR))

    expectErr(
      await WhatsAppConversationService.closeInactive(now),
      'DATABASE_ERROR',
    )
  })

  it('should log and skip a conversation that fails to close', async () => {
    mockedSettingsRepo.listAll.mockResolvedValue(ok([]))
    const broken = createFakeWhatsAppConversation({ id: 'broken' })
    const fine = createFakeWhatsAppConversation({ id: 'fine' })
    mockedConversationRepo.listInactiveOpen.mockResolvedValue(
      ok([broken, fine]),
    )
    mockedConversationRepo.update
      .mockResolvedValueOnce(err(DB_ERROR))
      .mockResolvedValueOnce(ok(fine))
    mockedEventRepo.create.mockResolvedValue(ok(fakeEvent()))
    mockedConversationRepo.findById.mockResolvedValue(
      ok(conversation({ id: 'fine' })),
    )

    const result = expectOk(
      await WhatsAppConversationService.closeInactive(now),
    )

    expect(result).toEqual({ closed: 1 })
    expect(logger.error).toHaveBeenCalledWith(
      'whatsapp.conversation.auto_close_failed',
      expect.objectContaining({
        conversationId: 'broken',
        reason: 'DATABASE_ERROR',
      }),
    )
  })

  it('should stop at the batch cap before querying the remaining windows', async () => {
    mockedSettingsRepo.listAll.mockResolvedValue(
      ok([
        createFakeWhatsAppSettings({
          workspaceId: 'wsCustom',
          autoCloseAfterHours: 2,
        }),
      ]),
    )
    const stale = Array.from({ length: 500 }, (_, i) =>
      createFakeWhatsAppConversation({ id: `c${i}`, workspaceId: 'ws1' }),
    )
    mockedConversationRepo.listInactiveOpen.mockResolvedValue(ok(stale))
    mockedConversationRepo.update.mockResolvedValue(ok(stale[0]))
    mockedEventRepo.create.mockResolvedValue(ok(fakeEvent()))
    mockedConversationRepo.findById.mockResolvedValue(ok(conversation()))

    const result = expectOk(
      await WhatsAppConversationService.closeInactive(now),
    )

    expect(result).toEqual({ closed: 500 })
    expect(mockedConversationRepo.listInactiveOpen).toHaveBeenCalledTimes(1)
  })
})
