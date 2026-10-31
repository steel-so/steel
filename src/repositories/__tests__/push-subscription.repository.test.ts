import { afterEach, describe, expect, it, vi } from 'vitest'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { PushSubscriptionRepository } from '../push-subscription.repository'

const input = (n: number) => ({
  endpoint: `https://push.example.com/${n}-${Math.random()}`,
  p256dh: 'p256dh',
  auth: 'auth',
})

describe('PushSubscriptionRepository', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should upsert by endpoint and move it to the latest user', async () => {
    const [a, b] = await Promise.all([seedUser(), seedUser()])
    const data = input(1)

    const first = expectOk(await PushSubscriptionRepository.upsert(a.id, data))
    const again = expectOk(
      await PushSubscriptionRepository.upsert(b.id, { ...data, userAgent: 'UA' }),
    )

    expect(again.id).toBe(first.id)
    expect(again.userId).toBe(b.id)
    expect(again.userAgent).toBe('UA')
    expect(expectOk(await PushSubscriptionRepository.countByUser(a.id))).toBe(0)
    expect(expectOk(await PushSubscriptionRepository.countByUser(b.id))).toBe(1)
  })

  it('should list by users, and nothing for an empty list', async () => {
    const [a, b, c] = await Promise.all([seedUser(), seedUser(), seedUser()])
    await PushSubscriptionRepository.upsert(a.id, input(1))
    await PushSubscriptionRepository.upsert(b.id, input(2))
    await PushSubscriptionRepository.upsert(c.id, input(3))

    const rows = expectOk(
      await PushSubscriptionRepository.listByUsers([a.id, b.id]),
    )
    expect(rows.map((row) => row.userId).sort()).toEqual([a.id, b.id].sort())
    expect(expectOk(await PushSubscriptionRepository.listByUsers([]))).toEqual([])
  })

  it('should delete only the caller device by endpoint', async () => {
    const [a, b] = await Promise.all([seedUser(), seedUser()])
    const data = input(1)
    await PushSubscriptionRepository.upsert(a.id, data)

    expect(
      expectOk(await PushSubscriptionRepository.deleteByEndpoint(b.id, data.endpoint)),
    ).toBe(0)
    expect(
      expectOk(await PushSubscriptionRepository.deleteByEndpoint(a.id, data.endpoint)),
    ).toBe(1)
  })

  it('should keep only the latest devices', async () => {
    const user = await seedUser()
    for (let i = 0; i < 4; i += 1) {
      await PushSubscriptionRepository.upsert(user.id, input(i))
      await new Promise((resolve) => setTimeout(resolve, 5))
    }

    expect(expectOk(await PushSubscriptionRepository.trimToLatest(user.id, 10))).toBe(0)
    expect(expectOk(await PushSubscriptionRepository.trimToLatest(user.id, 2))).toBe(2)
    expect(expectOk(await PushSubscriptionRepository.countByUser(user.id))).toBe(2)
  })

  it('should delete and touch by ids', async () => {
    const user = await seedUser()
    const row = expectOk(await PushSubscriptionRepository.upsert(user.id, input(1)))
    const at = new Date('2026-10-30T10:00:00Z')

    expect(expectOk(await PushSubscriptionRepository.touch([], at))).toBe(0)
    expect(expectOk(await PushSubscriptionRepository.touch([row.id], at))).toBe(1)
    expect(expectOk(await PushSubscriptionRepository.deleteByIds([]))).toBe(0)
    expect(expectOk(await PushSubscriptionRepository.deleteByIds([row.id]))).toBe(1)
  })

  it('should return DATABASE_ERROR on failures', async () => {
    expectErr(await PushSubscriptionRepository.upsert('missing', input(1)), 'DATABASE_ERROR')

    const methods = [
      ['count', () => PushSubscriptionRepository.countByUser('u')],
      ['findMany', () => PushSubscriptionRepository.listByUsers(['u'])],
      ['deleteMany', () => PushSubscriptionRepository.deleteByEndpoint('u', 'e')],
      ['deleteMany', () => PushSubscriptionRepository.deleteByIds(['i'])],
      ['updateMany', () => PushSubscriptionRepository.touch(['i'], new Date())],
      ['findMany', () => PushSubscriptionRepository.trimToLatest('u', 1)],
    ] as const
    for (const [method, call] of methods) {
      vi.spyOn(prisma.pushSubscription, method).mockRejectedValueOnce(new Error('boom'))
      expectErr(await call(), 'DATABASE_ERROR')
    }
  })
})
