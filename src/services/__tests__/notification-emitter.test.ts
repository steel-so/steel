import { beforeEach, describe, expect, it, vi } from 'vitest'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/repositories/notification-recipient.repository')
vi.mock('../notification.service', () => ({
  NotificationService: { notifyUsers: vi.fn() },
}))

import { logger } from '@/lib/axiom/logger'
import { NotificationRecipientRepository } from '@/src/repositories/notification-recipient.repository'
import { NotificationService } from '../notification.service'
import {
  emitNotification,
  workspaceAdminIds,
  workspaceMemberIds,
  workspaceOwnerIds,
} from '../notification-emitter'

const mockedRecipients = vi.mocked(NotificationRecipientRepository)
const mockedNotify = vi.mocked(NotificationService.notifyUsers)
const mockedLogger = vi.mocked(logger)

const DB_ERROR = { code: 'DATABASE_ERROR' as const, message: 'down' }

const base = {
  workspaceId: 'ws1',
  kind: 'CRM_LEAD_ASSIGNED' as const,
  title: 'Lead atribuído a você: Jane',
  body: 'corpo',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedRecipients.resolve.mockResolvedValue(
    ok({ slug: 'acme', memberIds: ['u2'] }),
  )
  mockedNotify.mockResolvedValue(ok(1))
})

describe('emitNotification', () => {
  it('should resolve members, prefix the slug and forward actor and dedupe key', async () => {
    const created = await emitNotification({
      ...base,
      recipients: ['u2', null, 'u2', undefined, 'gone'],
      actorId: 'u1',
      path: '/crm/leads?record=l1',
      dedupeKey: 'k1',
    })

    expect(created).toBe(1)
    expect(mockedRecipients.resolve).toHaveBeenCalledWith('ws1', ['u2', 'gone'])
    expect(mockedNotify).toHaveBeenCalledWith({
      ...base,
      userIds: ['u2'],
      actorId: 'u1',
      href: '/acme/crm/leads?record=l1',
      dedupeKey: 'k1',
    })
  })

  it('should never reach the repository when the only candidate is the actor', async () => {
    expect(
      await emitNotification({ ...base, recipients: ['u1'], actorId: 'u1' }),
    ).toBe(0)
    expect(mockedRecipients.resolve).not.toHaveBeenCalled()
  })

  it('should send no link when no path is given', async () => {
    await emitNotification({ ...base, recipients: ['u2'] })

    expect(mockedNotify).toHaveBeenCalledWith(
      expect.objectContaining({ href: undefined }),
    )
  })

  it('should skip ex-members and deleted workspaces', async () => {
    mockedRecipients.resolve.mockResolvedValueOnce(
      ok({ slug: 'acme', memberIds: [] }),
    )
    expect(await emitNotification({ ...base, recipients: ['gone'] })).toBe(0)

    mockedRecipients.resolve.mockResolvedValueOnce(ok(null))
    expect(await emitNotification({ ...base, recipients: ['u2'] })).toBe(0)

    expect(mockedNotify).not.toHaveBeenCalled()
  })

  it('should log and swallow a lookup failure', async () => {
    mockedRecipients.resolve.mockResolvedValue(err(DB_ERROR))

    expect(await emitNotification({ ...base, recipients: ['u2'] })).toBe(0)
    expect(mockedLogger.warn).toHaveBeenCalledWith(
      'notifications.emit.failed',
      {
        component: 'NotificationEmitter',
        workspaceId: 'ws1',
        detail: '{"kind":"CRM_LEAD_ASSIGNED","reason":"DATABASE_ERROR"}',
      },
    )
  })

  it('should log and swallow a delivery failure', async () => {
    mockedNotify.mockResolvedValue(err(DB_ERROR))

    expect(await emitNotification({ ...base, recipients: ['u2'] })).toBe(0)
    expect(mockedLogger.warn).toHaveBeenCalled()
  })

  it('should never throw, even when something below throws', async () => {
    mockedNotify.mockRejectedValueOnce(new Error('boom'))
    expect(await emitNotification({ ...base, recipients: ['u2'] })).toBe(0)

    mockedNotify.mockRejectedValueOnce('weird')
    expect(await emitNotification({ ...base, recipients: ['u2'] })).toBe(0)

    expect(mockedLogger.warn).toHaveBeenCalledWith(
      'notifications.emit.failed',
      expect.objectContaining({ detail: expect.stringContaining('weird') }),
    )
  })
})

describe('workspace audiences', () => {
  it('should list admins and owners', async () => {
    mockedRecipients.listPrivilegedIds.mockResolvedValue(ok(['o1', 'a1']))
    mockedRecipients.listOwnerIds.mockResolvedValue(ok(['o1']))
    mockedRecipients.listMemberIds.mockResolvedValue(ok(['o1', 'a1', 'm1']))

    expect(await workspaceAdminIds('ws1')).toEqual(['o1', 'a1'])
    expect(await workspaceOwnerIds('ws1')).toEqual(['o1'])
    expect(await workspaceMemberIds('ws1')).toEqual(['o1', 'a1', 'm1'])
  })

  it('should degrade to nobody on a lookup failure', async () => {
    mockedRecipients.listPrivilegedIds.mockResolvedValue(err(DB_ERROR))
    mockedRecipients.listOwnerIds.mockResolvedValue(err(DB_ERROR))
    mockedRecipients.listMemberIds.mockResolvedValue(err(DB_ERROR))

    expect(await workspaceAdminIds('ws1')).toEqual([])
    expect(await workspaceOwnerIds('ws1')).toEqual([])
    expect(await workspaceMemberIds('ws1')).toEqual([])
    expect(mockedLogger.warn).toHaveBeenCalledTimes(3)
  })
})
