import type { Notification } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { notificationKindsOfModule } from '@/src/lib/notification-kind'
import { err, ok } from '@/src/lib/result'
import type { NotificationListQueryDTO } from '@/src/schemas/notification.schema'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/notification.repository')
vi.mock('@/src/repositories/notification-preference.repository')
vi.mock('@/src/repositories/user-preference.repository')
vi.mock('../notification-whatsapp.service', () => ({
  NotificationWhatsappService: { enqueue: vi.fn() },
}))
vi.mock('@/src/lib/notifications/realtime', () => ({
  publishNotificationEvent: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))

import { auditMutation } from '@/lib/axiom/audit'
import { publishNotificationEvent } from '@/src/lib/notifications/realtime'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { NotificationRepository } from '@/src/repositories/notification.repository'
import { NotificationPreferenceRepository } from '@/src/repositories/notification-preference.repository'
import { UserPreferenceRepository } from '@/src/repositories/user-preference.repository'
import { NotificationService } from '../notification.service'

const mockedMembershipRepo = vi.mocked(MembershipRepository)
const mockedNotificationRepo = vi.mocked(NotificationRepository)
const mockedPublish = vi.mocked(publishNotificationEvent)
const mockedAuditMutation = vi.mocked(auditMutation)

function row(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 'n1',
    workspaceId: 'ws1',
    userId: 'u1',
    kind: 'WHATSAPP_NEGATIVE_SENTIMENT',
    title: 'Sentimento negativo: Maria',
    body: 'Média -0,50',
    href: '/clinica/zap?conversa=c1',
    readAt: null,
    dedupeKey: null,
    archivedAt: null,
    deletedAt: null,
    snoozedUntil: null,
    createdAt: new Date('2026-09-18T12:00:00Z'),
    ...overrides,
  }
}

const COUNTS = { all: 3, unread: 1, archived: 2, snoozed: 0 }

function asMember(role: 'OWNER' | 'MEMBER' | 'VIEWER' = 'MEMBER') {
  mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )
}

function query(
  overrides: Partial<NotificationListQueryDTO> = {},
): NotificationListQueryDTO {
  return { folder: 'all', limit: 25, ...overrides }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedNotificationRepo.listPage.mockResolvedValue(
    ok({ items: [row()], nextCursor: null }),
  )
  mockedNotificationRepo.countFolders.mockResolvedValue(ok(COUNTS))
  vi.mocked(
    NotificationPreferenceRepository,
  ).listMutedUserIds.mockResolvedValue(ok([]))
})

describe('NotificationService.list', () => {
  it('should list the actor notifications with the unread count', async () => {
    asMember()

    const result = expectOk(await NotificationService.list('u1', 'ws1'))

    expect(result.unreadCount).toBe(1)
    expect(result.counts).toEqual(COUNTS)
    expect(result.nextCursor).toBeNull()
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        id: 'n1',
        read: false,
        archived: false,
        module: 'COMMUNICATION',
      }),
    )
    expect(mockedNotificationRepo.listPage).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      userId: 'u1',
      folder: 'all',
      kinds: undefined,
      search: undefined,
      cursor: undefined,
      limit: 50,
      now: expect.any(Date),
    })
  })

  it('should forbid non-members', async () => {
    mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(await NotificationService.list('x', 'ws1'), 'FORBIDDEN')
  })
})

describe('NotificationService.listInbox', () => {
  it('should forward the folder, search and cursor to the repository', async () => {
    asMember('VIEWER')
    mockedNotificationRepo.listPage.mockResolvedValue(
      ok({ items: [row({ archivedAt: new Date() })], nextCursor: 'n9' }),
    )

    const result = expectOk(
      await NotificationService.listInbox(
        'u1',
        'ws1',
        query({ folder: 'archived', search: 'sla', cursor: 'n5', limit: 10 }),
      ),
    )

    expect(result.nextCursor).toBe('n9')
    expect(result.items[0].archived).toBe(true)
    expect(mockedNotificationRepo.listPage).toHaveBeenCalledWith(
      expect.objectContaining({
        folder: 'archived',
        search: 'sla',
        cursor: 'n5',
        limit: 10,
      }),
    )
  })

  it('should translate a module filter into its kinds', async () => {
    asMember()

    await NotificationService.listInbox(
      'u1',
      'ws1',
      query({ module: 'COMMUNICATION' }),
    )

    expect(mockedNotificationRepo.listPage).toHaveBeenCalledWith(
      expect.objectContaining({
        kinds: notificationKindsOfModule('COMMUNICATION'),
      }),
    )
    expect(notificationKindsOfModule('COMMUNICATION')).toContain(
      'WHATSAPP_NEGATIVE_SENTIMENT',
    )
  })

  it('should narrow a kind filter to that single kind', async () => {
    asMember()

    await NotificationService.listInbox(
      'u1',
      'ws1',
      query({ kind: 'SD_SLA_BREACHED' }),
    )

    expect(mockedNotificationRepo.listPage).toHaveBeenCalledWith(
      expect.objectContaining({ kinds: ['SD_SLA_BREACHED'] }),
    )
  })

  it('should return nothing when the kind does not belong to the module', async () => {
    asMember()

    await NotificationService.listInbox(
      'u1',
      'ws1',
      query({ module: 'CRM', kind: 'SD_SLA_BREACHED' }),
    )

    expect(mockedNotificationRepo.listPage).toHaveBeenCalledWith(
      expect.objectContaining({ kinds: [] }),
    )
  })

  it('should keep the kind when it does belong to the module', async () => {
    asMember()

    await NotificationService.listInbox(
      'u1',
      'ws1',
      query({ module: 'SERVICE_DESK', kind: 'SD_SLA_BREACHED' }),
    )

    expect(mockedNotificationRepo.listPage).toHaveBeenCalledWith(
      expect.objectContaining({ kinds: ['SD_SLA_BREACHED'] }),
    )
  })

  it('should forbid non-members', async () => {
    mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))

    expectErr(
      await NotificationService.listInbox('x', 'ws1', query()),
      'FORBIDDEN',
    )
    expect(mockedNotificationRepo.listPage).not.toHaveBeenCalled()
  })
})

describe('NotificationService.markRead', () => {
  it('should only mark the actor own notifications as read', async () => {
    asMember('VIEWER')
    mockedNotificationRepo.markRead.mockResolvedValue(ok(2))

    expect(
      expectOk(await NotificationService.markRead('u1', 'ws1', {})),
    ).toEqual({ updated: 2 })
    expect(mockedNotificationRepo.markRead).toHaveBeenCalledWith(
      'ws1',
      'u1',
      undefined,
      undefined,
    )
  })
})

describe('NotificationService.applyAction', () => {
  it('should apply an action to the deduped ids', async () => {
    asMember()
    mockedNotificationRepo.applyAction.mockResolvedValue(ok(2))

    expect(
      expectOk(
        await NotificationService.applyAction('u1', 'ws1', {
          action: 'archive',
          ids: ['n1', 'n2', 'n1'],
        }),
      ),
    ).toEqual({ updated: 2 })
    expect(mockedNotificationRepo.applyAction).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      userId: 'u1',
      ids: ['n1', 'n2'],
      action: 'archive',
    })
  })

  it('should accept the undo of a deletion and audit it', async () => {
    asMember()
    mockedNotificationRepo.applyAction.mockResolvedValue(ok(1))

    expect(
      expectOk(
        await NotificationService.applyAction('u1', 'ws1', {
          action: 'restore',
          ids: ['n1'],
        }),
      ),
    ).toEqual({ updated: 1 })
    expect(mockedAuditMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'notification',
        action: 'restore',
        actorId: 'u1',
        meta: { workspaceId: 'ws1', updated: 1 },
      }),
    )
  })

  it('should not audit reading or archiving', async () => {
    asMember()
    mockedNotificationRepo.applyAction.mockResolvedValue(ok(1))

    await NotificationService.applyAction('u1', 'ws1', {
      action: 'read',
      ids: ['n1'],
    })

    expect(mockedAuditMutation).not.toHaveBeenCalled()
  })

  it('should forbid non-members', async () => {
    mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))

    expectErr(
      await NotificationService.applyAction('u1', 'ws1', {
        action: 'delete',
        ids: ['n1'],
      }),
      'FORBIDDEN',
    )
    expect(mockedNotificationRepo.applyAction).not.toHaveBeenCalled()
  })
})

describe('NotificationService.notifyUsers', () => {
  it('should dedupe recipients and publish the realtime event', async () => {
    mockedNotificationRepo.createMany.mockResolvedValue(ok(2))

    expect(
      expectOk(
        await NotificationService.notifyUsers({
          workspaceId: 'ws1',
          userIds: ['a', 'b', 'a'],
          kind: 'WHATSAPP_NEGATIVE_SENTIMENT',
          title: 't',
          body: 'b',
        }),
      ),
    ).toBe(2)

    expect(mockedNotificationRepo.createMany).toHaveBeenCalledWith([
      expect.objectContaining({ userId: 'a', href: null }),
      expect.objectContaining({ userId: 'b' }),
    ])
    expect(mockedPublish).toHaveBeenCalledWith(
      'ws1',
      ['a', 'b'],
      expect.objectContaining({
        type: 'notification.created',
        kind: 'WHATSAPP_NEGATIVE_SENTIMENT',
      }),
    )
  })

  it('should not publish when nothing was created', async () => {
    mockedNotificationRepo.createMany.mockResolvedValue(ok(0))

    await NotificationService.notifyUsers({
      workspaceId: 'ws1',
      userIds: [],
      kind: 'SD_TICKET_ASSIGNED',
      title: 't',
      body: 'b',
      href: '/acme/servicedesk/tickets/1',
    })

    expect(mockedPublish).not.toHaveBeenCalled()
  })
})

describe('NotificationService failure paths', () => {
  const DB_ERROR = { code: 'DATABASE_ERROR' as const, message: 'db down' }

  it('listInbox() should propagate a listing failure', async () => {
    asMember()
    mockedNotificationRepo.listPage.mockResolvedValue(err(DB_ERROR))

    expectErr(
      await NotificationService.listInbox('u1', 'ws1', query()),
      'DATABASE_ERROR',
    )
  })

  it('listInbox() should propagate a folder count failure', async () => {
    asMember()
    mockedNotificationRepo.countFolders.mockResolvedValue(err(DB_ERROR))

    expectErr(
      await NotificationService.listInbox('u1', 'ws1', query()),
      'DATABASE_ERROR',
    )
  })

  it('markRead() should forbid non-members', async () => {
    mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))

    expectErr(await NotificationService.markRead('u1', 'ws1', {}), 'FORBIDDEN')
    expect(mockedNotificationRepo.markRead).not.toHaveBeenCalled()
  })

  it('markRead() should propagate an update failure', async () => {
    asMember()
    mockedNotificationRepo.markRead.mockResolvedValue(err(DB_ERROR))

    expectErr(
      await NotificationService.markRead('u1', 'ws1', { ids: ['n1'] }),
      'DATABASE_ERROR',
    )
  })

  it('applyAction() should propagate an update failure', async () => {
    asMember()
    mockedNotificationRepo.applyAction.mockResolvedValue(err(DB_ERROR))

    expectErr(
      await NotificationService.applyAction('u1', 'ws1', {
        action: 'delete',
        ids: ['n1'],
      }),
      'DATABASE_ERROR',
    )
    expect(mockedAuditMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'notification',
        action: 'delete',
        outcome: 'failure',
        reason: 'DATABASE_ERROR',
      }),
    )
  })

  it('applyAction() should not audit a non-destructive failure', async () => {
    asMember()
    mockedNotificationRepo.applyAction.mockResolvedValue(err(DB_ERROR))

    expectErr(
      await NotificationService.applyAction('u1', 'ws1', {
        action: 'read',
        ids: ['n1'],
      }),
      'DATABASE_ERROR',
    )
    expect(mockedAuditMutation).not.toHaveBeenCalled()
  })

  it('notifyUsers() should propagate a creation failure without publishing', async () => {
    mockedNotificationRepo.createMany.mockResolvedValue(err(DB_ERROR))

    expectErr(
      await NotificationService.notifyUsers({
        workspaceId: 'ws1',
        userIds: ['a'],
        kind: 'SD_DIGEST',
        title: 't',
        body: 'b',
      }),
      'DATABASE_ERROR',
    )
    expect(mockedPublish).not.toHaveBeenCalled()
  })
})

describe('NotificationService.notifyUsers — actor, preferences and dedupe', () => {
  const mockedPreferenceRepo = vi.mocked(NotificationPreferenceRepository)

  beforeEach(() => {
    mockedPreferenceRepo.listMutedUserIds.mockResolvedValue(ok([]))
    mockedNotificationRepo.createMany.mockImplementation(async (rows) =>
      ok(rows.length),
    )
  })

  it('should never notify the actor of the action', async () => {
    expectOk(
      await NotificationService.notifyUsers({
        workspaceId: 'ws1',
        userIds: ['actor', 'b'],
        actorId: 'actor',
        kind: 'CRM_LEAD_ASSIGNED',
        title: 't',
        body: 'b',
      }),
    )

    expect(mockedNotificationRepo.createMany).toHaveBeenCalledWith([
      expect.objectContaining({ userId: 'b' }),
    ])
    expect(mockedPublish).toHaveBeenCalledWith('ws1', ['b'], expect.anything())
  })

  it('should not deliver a muted kind', async () => {
    mockedPreferenceRepo.listMutedUserIds.mockResolvedValue(ok(['a']))

    expect(
      expectOk(
        await NotificationService.notifyUsers({
          workspaceId: 'ws1',
          userIds: ['a', 'b'],
          kind: 'CRM_TASK_DUE',
          title: 't',
          body: 'b',
        }),
      ),
    ).toBe(1)

    expect(mockedPreferenceRepo.listMutedUserIds).toHaveBeenCalledWith(
      'ws1',
      'CRM_TASK_DUE',
      ['a', 'b'],
    )
    expect(mockedNotificationRepo.createMany).toHaveBeenCalledWith([
      expect.objectContaining({ userId: 'b' }),
    ])
  })

  it('should leave ServiceDesk kinds to their own preferences', async () => {
    await NotificationService.notifyUsers({
      workspaceId: 'ws1',
      userIds: ['a'],
      kind: 'SD_TICKET_ASSIGNED',
      title: 't',
      body: 'b',
    })

    expect(mockedPreferenceRepo.listMutedUserIds).not.toHaveBeenCalled()
  })

  it('should skip the preference lookup when only the actor was a candidate', async () => {
    expectOk(
      await NotificationService.notifyUsers({
        workspaceId: 'ws1',
        userIds: ['actor'],
        actorId: 'actor',
        kind: 'CRM_DEAL_CLOSED',
        title: 't',
        body: 'b',
      }),
    )

    expect(mockedPreferenceRepo.listMutedUserIds).not.toHaveBeenCalled()
    expect(mockedPublish).not.toHaveBeenCalled()
  })

  it('should fail open (deliver to everyone) when the preference lookup fails', async () => {
    mockedPreferenceRepo.listMutedUserIds.mockResolvedValue(
      err({ code: 'DATABASE_ERROR', message: 'down' }),
    )

    expect(
      expectOk(
        await NotificationService.notifyUsers({
          workspaceId: 'ws1',
          userIds: ['a'],
          kind: 'MEMBER_JOINED',
          title: 't',
          body: 'b',
        }),
      ),
    ).toBe(1)
    expect(mockedNotificationRepo.createMany).toHaveBeenCalledWith([
      expect.objectContaining({ userId: 'a' }),
    ])
  })

  it('should store the dedupe key on every row', async () => {
    await NotificationService.notifyUsers({
      workspaceId: 'ws1',
      userIds: ['a'],
      kind: 'CRM_TASK_DUE',
      title: 't',
      body: 'b',
      href: '/acme/crm/tasks?record=t1',
      dedupeKey: 'crm-task-due:t1',
    })

    expect(mockedNotificationRepo.createMany).toHaveBeenCalledWith([
      expect.objectContaining({
        dedupeKey: 'crm-task-due:t1',
        href: '/acme/crm/tasks?record=t1',
      }),
    ])
  })
})

describe('NotificationService.listInbox — quick filters', () => {
  it('should translate "mentions" into the mention kinds and forward now', async () => {
    asMember()
    const now = new Date('2026-10-07T12:00:00Z')

    expectOk(
      await NotificationService.listInbox(
        'u1',
        'ws1',
        query({ quick: 'mentions' }),
        now,
      ),
    )

    expect(mockedNotificationRepo.listPage).toHaveBeenCalledWith(
      expect.objectContaining({ kinds: ['SD_TICKET_MENTIONED'], now }),
    )
    expect(mockedNotificationRepo.countFolders).toHaveBeenCalledWith(
      'ws1',
      'u1',
      now,
    )
  })

  it('should intersect "assigned" with the module', async () => {
    asMember()

    expectOk(
      await NotificationService.listInbox(
        'u1',
        'ws1',
        query({ quick: 'assigned', module: 'CRM' }),
      ),
    )

    expect(mockedNotificationRepo.listPage).toHaveBeenCalledWith(
      expect.objectContaining({
        kinds: [
          'CRM_LEAD_ASSIGNED',
          'CRM_OPPORTUNITY_ASSIGNED',
          'CRM_TASK_ASSIGNED',
        ],
      }),
    )
  })

  it('should return no kinds when the quick filter misses the module', async () => {
    asMember()

    expectOk(
      await NotificationService.listInbox(
        'u1',
        'ws1',
        query({ quick: 'mentions', module: 'CRM' }),
      ),
    )

    expect(mockedNotificationRepo.listPage).toHaveBeenCalledWith(
      expect.objectContaining({ kinds: [] }),
    )
  })

  it('should intersect the quick filter with a kind', async () => {
    asMember()

    expectOk(
      await NotificationService.listInbox(
        'u1',
        'ws1',
        query({ quick: 'assigned', kind: 'SD_TICKET_ASSIGNED' }),
      ),
    )
    expect(mockedNotificationRepo.listPage).toHaveBeenLastCalledWith(
      expect.objectContaining({ kinds: ['SD_TICKET_ASSIGNED'] }),
    )

    expectOk(
      await NotificationService.listInbox(
        'u1',
        'ws1',
        query({ quick: 'assigned', kind: 'SD_SLA_BREACHED' }),
      ),
    )
    expect(mockedNotificationRepo.listPage).toHaveBeenLastCalledWith(
      expect.objectContaining({ kinds: [] }),
    )
  })
})

describe('NotificationService.markRead — scope', () => {
  it('should ignore the module/kind scope when ids are given', async () => {
    asMember()
    mockedNotificationRepo.markRead.mockResolvedValue(ok(1))

    expectOk(
      await NotificationService.markRead('u1', 'ws1', {
        ids: ['n1'],
        module: 'CRM',
      }),
    )

    expect(mockedNotificationRepo.markRead).toHaveBeenCalledWith(
      'ws1',
      'u1',
      ['n1'],
      undefined,
    )
  })

  it('should mark all of a module as read', async () => {
    asMember()
    mockedNotificationRepo.markRead.mockResolvedValue(ok(4))

    expect(
      expectOk(
        await NotificationService.markRead('u1', 'ws1', {
          module: 'SERVICE_DESK',
        }),
      ),
    ).toEqual({ updated: 4 })

    expect(mockedNotificationRepo.markRead).toHaveBeenCalledWith(
      'ws1',
      'u1',
      undefined,
      notificationKindsOfModule('SERVICE_DESK'),
    )
  })

  it('should mark all of a single kind as read', async () => {
    asMember()
    mockedNotificationRepo.markRead.mockResolvedValue(ok(1))

    expectOk(
      await NotificationService.markRead('u1', 'ws1', {
        kind: 'CRM_LEAD_ASSIGNED',
      }),
    )

    expect(mockedNotificationRepo.markRead).toHaveBeenCalledWith(
      'ws1',
      'u1',
      undefined,
      ['CRM_LEAD_ASSIGNED'],
    )
  })
})

describe('NotificationService.archiveRead', () => {
  it('should archive every read notification of the actor', async () => {
    asMember('VIEWER')
    mockedNotificationRepo.archiveRead.mockResolvedValue(ok(3))

    expect(
      expectOk(await NotificationService.archiveRead('u1', 'ws1', {})),
    ).toEqual({ updated: 3 })
    expect(mockedNotificationRepo.archiveRead).toHaveBeenCalledWith(
      'ws1',
      'u1',
      undefined,
    )
  })

  it('should narrow to the module/kind on screen', async () => {
    asMember()
    mockedNotificationRepo.archiveRead.mockResolvedValue(ok(1))

    expectOk(
      await NotificationService.archiveRead('u1', 'ws1', {
        module: 'COMMUNICATION',
        kind: 'WHATSAPP_AI_HANDOFF',
      }),
    )
    expect(mockedNotificationRepo.archiveRead).toHaveBeenCalledWith(
      'ws1',
      'u1',
      ['WHATSAPP_AI_HANDOFF'],
    )
  })

  it('should forbid non-members', async () => {
    mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))

    expectErr(
      await NotificationService.archiveRead('x', 'ws1', {}),
      'FORBIDDEN',
    )
    expect(mockedNotificationRepo.archiveRead).not.toHaveBeenCalled()
  })

  it('should propagate an update failure', async () => {
    asMember()
    mockedNotificationRepo.archiveRead.mockResolvedValue(
      err({ code: 'DATABASE_ERROR', message: 'down' }),
    )

    expectErr(
      await NotificationService.archiveRead('u1', 'ws1', {}),
      'DATABASE_ERROR',
    )
  })
})

describe('NotificationService.snooze', () => {
  const mockedUserPreference = vi.mocked(UserPreferenceRepository)
  // Wednesday 2026-10-07 10:00 in São Paulo (UTC-3).
  const now = new Date('2026-10-07T13:00:00Z')

  it('should snooze the deduped ids until the preset in the user timezone', async () => {
    asMember()
    mockedUserPreference.findByUserId.mockResolvedValue(
      ok({ timezone: 'Europe/Lisbon' } as never),
    )
    mockedNotificationRepo.snooze.mockResolvedValue(ok(2))

    const result = expectOk(
      await NotificationService.snooze(
        'u1',
        'ws1',
        { ids: ['n1', 'n2', 'n1'], preset: 'tomorrow' },
        now,
      ),
    )

    // Lisbon is UTC+1 in October: 09:00 local = 08:00 UTC.
    expect(result).toEqual({
      updated: 2,
      snoozedUntil: '2026-10-08T08:00:00.000Z',
    })
    expect(mockedUserPreference.findByUserId).toHaveBeenCalledWith('u1')
    expect(mockedNotificationRepo.snooze).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      userId: 'u1',
      ids: ['n1', 'n2'],
      until: new Date('2026-10-08T08:00:00.000Z'),
    })
  })

  it('should fall back to the platform timezone without preferences', async () => {
    asMember()
    mockedUserPreference.findByUserId.mockResolvedValue(
      err({ code: 'RESOURCE_NOT_FOUND', message: 'UserPreference' } as never),
    )
    mockedNotificationRepo.snooze.mockResolvedValue(ok(1))

    const result = expectOk(
      await NotificationService.snooze(
        'u1',
        'ws1',
        { ids: ['n1'], preset: 'tomorrow' },
        now,
      ),
    )

    expect(result.snoozedUntil).toBe('2026-10-08T12:00:00.000Z')
  })

  it('should forbid non-members', async () => {
    mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))

    expectErr(
      await NotificationService.snooze('x', 'ws1', {
        ids: ['n1'],
        preset: '1h',
      }),
      'FORBIDDEN',
    )
    expect(mockedNotificationRepo.snooze).not.toHaveBeenCalled()
  })

  it('should propagate an update failure', async () => {
    asMember()
    mockedUserPreference.findByUserId.mockResolvedValue(
      ok({ timezone: 'America/Sao_Paulo' } as never),
    )
    mockedNotificationRepo.snooze.mockResolvedValue(
      err({ code: 'DATABASE_ERROR', message: 'down' }),
    )

    expectErr(
      await NotificationService.snooze(
        'u1',
        'ws1',
        { ids: ['n1'], preset: '3h' },
        now,
      ),
      'DATABASE_ERROR',
    )
  })
})

describe('NotificationService.notifyUsers — realtime payload', () => {
  it('should publish title, body and href for the desktop notification', async () => {
    mockedNotificationRepo.createMany.mockResolvedValue(ok(1))

    await NotificationService.notifyUsers({
      workspaceId: 'ws1',
      userIds: ['a'],
      kind: 'SD_SLA_BREACHED',
      title: 'SLA violado',
      body: 'INC-1',
      href: '/acme/servicedesk/tickets/1',
    })

    expect(mockedPublish).toHaveBeenCalledWith(
      'ws1',
      ['a'],
      expect.objectContaining({
        kind: 'SD_SLA_BREACHED',
        title: 'SLA violado',
        body: 'INC-1',
        href: '/acme/servicedesk/tickets/1',
      }),
    )
  })

  it('should publish a null href when there is no link', async () => {
    mockedNotificationRepo.createMany.mockResolvedValue(ok(1))

    await NotificationService.notifyUsers({
      workspaceId: 'ws1',
      userIds: ['a'],
      kind: 'SD_SLA_BREACHED',
      title: 't',
      body: 'b',
    })

    expect(mockedPublish).toHaveBeenCalledWith(
      'ws1',
      ['a'],
      expect.objectContaining({ href: null }),
    )
  })
})
