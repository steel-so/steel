import type { PushSubscription } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/push-subscription.repository')
vi.mock('@/src/lib/push/vapid', () => ({ getVapidKeys: vi.fn() }))
vi.mock('@/src/lib/push/web-push', () => ({ sendWebPush: vi.fn() }))
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))

import { auditMutation } from '@/lib/axiom/audit'
import { getVapidKeys } from '@/src/lib/push/vapid'
import { sendWebPush } from '@/src/lib/push/web-push'
import { PushSubscriptionRepository } from '@/src/repositories/push-subscription.repository'
import { MAX_PUSH_DEVICES_PER_USER, PushService } from '../push.service'

const repo = vi.mocked(PushSubscriptionRepository)
const vapid = vi.mocked(getVapidKeys)
const send = vi.mocked(sendWebPush)
const audit = vi.mocked(auditMutation)

const KEYS = { publicKey: 'pub', privateKey: 'priv', subject: 'mailto:a@b.c' }
const DB_ERROR = { code: 'DATABASE_ERROR' as const, message: 'down' }
const DTO = {
  endpoint: 'https://push.example.com/a',
  keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
}

function sub(id: string, userId = 'u1'): PushSubscription {
  return {
    id,
    userId,
    endpoint: `https://push.example.com/${id}`,
    p256dh: 'k',
    auth: 'a',
    userAgent: null,
    createdAt: new Date(),
    lastUsedAt: null,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vapid.mockReturnValue(KEYS)
  repo.countByUser.mockResolvedValue(ok(2))
  repo.upsert.mockResolvedValue(ok(sub('s1')))
  repo.trimToLatest.mockResolvedValue(ok(0))
  repo.deleteByEndpoint.mockResolvedValue(ok(1))
  repo.listByUsers.mockResolvedValue(ok([sub('s1'), sub('s2', 'u2')]))
  repo.touch.mockResolvedValue(ok(1))
  repo.deleteByIds.mockResolvedValue(ok(0))
})

describe('PushService.status', () => {
  it('should report OFF without VAPID keys', async () => {
    vapid.mockReturnValue(null)

    expect(expectOk(await PushService.status('u1'))).toEqual({
      enabled: false,
      publicKey: null,
      devices: 0,
    })
    expect(repo.countByUser).not.toHaveBeenCalled()
  })

  it('should report the public key and device count', async () => {
    expect(expectOk(await PushService.status('u1'))).toEqual({
      enabled: true,
      publicKey: 'pub',
      devices: 2,
    })
  })

  it('should propagate database errors', async () => {
    repo.countByUser.mockResolvedValue(err(DB_ERROR))
    expectErr(await PushService.status('u1'), 'DATABASE_ERROR')
  })
})

describe('PushService.subscribe', () => {
  it('should be inert while push is OFF', async () => {
    vapid.mockReturnValue(null)

    const result = expectOk(await PushService.subscribe('u1', DTO, 'UA'))

    expect(result.enabled).toBe(false)
    expect(repo.upsert).not.toHaveBeenCalled()
  })

  it('should save the device, trim old ones and audit', async () => {
    const result = expectOk(
      await PushService.subscribe('u1', DTO, 'x'.repeat(400)),
    )

    expect(result.devices).toBe(2)
    expect(repo.upsert).toHaveBeenCalledWith('u1', {
      endpoint: DTO.endpoint,
      p256dh: 'p256dh-key',
      auth: 'auth-key',
      userAgent: 'x'.repeat(255),
    })
    expect(repo.trimToLatest).toHaveBeenCalledWith(
      'u1',
      MAX_PUSH_DEVICES_PER_USER,
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'push_subscription', action: 'create' }),
    )
  })

  it('should accept a missing user agent', async () => {
    await PushService.subscribe('u1', DTO, null)
    expect(repo.upsert).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ userAgent: null }),
    )
  })

  it('should propagate save and trim errors', async () => {
    repo.upsert.mockResolvedValue(err(DB_ERROR))
    expectErr(await PushService.subscribe('u1', DTO, null), 'DATABASE_ERROR')

    repo.upsert.mockResolvedValue(ok(sub('s1')))
    repo.trimToLatest.mockResolvedValue(err(DB_ERROR))
    expectErr(await PushService.subscribe('u1', DTO, null), 'DATABASE_ERROR')
  })
})

describe('PushService.unsubscribe', () => {
  it('should remove the caller device and audit', async () => {
    expectOk(await PushService.unsubscribe('u1', DTO.endpoint))

    expect(repo.deleteByEndpoint).toHaveBeenCalledWith('u1', DTO.endpoint)
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'push_subscription', action: 'delete' }),
    )
  })

  it('should not audit when nothing was removed', async () => {
    repo.deleteByEndpoint.mockResolvedValue(ok(0))

    expectOk(await PushService.unsubscribe('u1', DTO.endpoint))

    expect(audit).not.toHaveBeenCalled()
  })

  it('should propagate database errors', async () => {
    repo.deleteByEndpoint.mockResolvedValue(err(DB_ERROR))
    expectErr(await PushService.unsubscribe('u1', DTO.endpoint), 'DATABASE_ERROR')
  })
})

describe('PushService.notifyUsers', () => {
  const input = {
    workspaceId: 'ws1',
    userIds: ['u1', 'u2'],
    kind: 'SD_SLA_AT_RISK',
    href: '/acme/servicedesk/tickets/t1',
  }

  it('should skip kinds that are not push kinds', async () => {
    expect(await PushService.notifyUsers({ ...input, kind: 'SD_TICKET_MESSAGE' })).toBe(0)
    expect(repo.listByUsers).not.toHaveBeenCalled()
  })

  it('should be inert without VAPID keys or recipients', async () => {
    vapid.mockReturnValue(null)
    expect(await PushService.notifyUsers(input)).toBe(0)

    vapid.mockReturnValue(KEYS)
    expect(await PushService.notifyUsers({ ...input, userIds: [] })).toBe(0)
    expect(send).not.toHaveBeenCalled()
  })

  it('should do nothing when nobody subscribed', async () => {
    repo.listByUsers.mockResolvedValue(ok([]))
    expect(await PushService.notifyUsers(input)).toBe(0)
    expect(send).not.toHaveBeenCalled()
  })

  it('should return 0 when the lookup fails', async () => {
    repo.listByUsers.mockResolvedValue(err(DB_ERROR))
    expect(await PushService.notifyUsers(input)).toBe(0)
  })

  it('should send a short generic payload, touch the accepted and drop the gone', async () => {
    send
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, gone: true, status: 410 })

    expect(await PushService.notifyUsers(input)).toBe(1)

    const payload = JSON.parse(send.mock.calls[0][1])
    expect(Object.keys(payload).sort()).toEqual(['body', 'tag', 'title', 'url'])
    expect(payload.url).toBe('/acme/servicedesk/tickets/t1')
    expect(send.mock.calls[0][3]).toEqual(
      expect.objectContaining({ urgency: 'high' }),
    )
    expect(repo.touch).toHaveBeenCalledWith(['s1'], expect.any(Date))
    expect(repo.deleteByIds).toHaveBeenCalledWith(['s2'])
  })

  it('should keep subscriptions after transient failures', async () => {
    send.mockResolvedValue({ ok: false, gone: false, status: 500 })

    expect(await PushService.notifyUsers(input)).toBe(0)
    expect(repo.deleteByIds).toHaveBeenCalledWith([])
  })

  it('should never throw', async () => {
    send.mockRejectedValue(new Error('boom'))
    expect(await PushService.notifyUsers(input)).toBe(0)

    send.mockRejectedValue('weird')
    expect(await PushService.notifyUsers(input)).toBe(0)
  })
})
