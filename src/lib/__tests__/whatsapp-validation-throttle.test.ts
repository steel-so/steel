import { beforeEach, describe, expect, it, vi } from 'vitest'

const { redisMock, consumeMock } = vi.hoisted(() => ({
  redisMock: {
    set: vi.fn(),
    get: vi.fn(),
    del: vi.fn(),
    pExpire: vi.fn(),
  },
  consumeMock: vi.fn(),
}))

vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/lib/redis', () => ({
  redis: redisMock,
  ensureRedisConnected: vi.fn(async () => redisMock),
}))
vi.mock('@/src/lib/rate-limit', () => ({
  zapiPlatformCheckLimiter: {},
  consume: consumeMock,
}))

import {
  acquirePlatformLease,
  PLATFORM_VALIDATION_MAX_CONCURRENT,
  reservePlatformBudget,
} from '@/src/lib/whatsapp/validation-throttle'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('acquirePlatformLease()', () => {
  it('takes the first free slot and releases only its own token', async () => {
    redisMock.set.mockResolvedValueOnce(null).mockResolvedValueOnce('OK')
    const lease = await acquirePlatformLease()
    expect(lease).not.toBeNull()
    expect(redisMock.set).toHaveBeenCalledTimes(2)

    redisMock.get.mockResolvedValue('someone-else')
    await lease?.release()
    expect(redisMock.del).not.toHaveBeenCalled()

    redisMock.get.mockImplementation(async () => redisMock.set.mock.calls[1][1])
    await lease?.release()
    expect(redisMock.del).toHaveBeenCalledTimes(1)
  })

  it('returns null when every slot is busy (global concurrency cap)', async () => {
    redisMock.set.mockResolvedValue(null)
    expect(await acquirePlatformLease()).toBeNull()
    expect(redisMock.set).toHaveBeenCalledTimes(
      PLATFORM_VALIDATION_MAX_CONCURRENT,
    )
  })

  it('fails open when Redis is down', async () => {
    redisMock.set.mockRejectedValue(new Error('redis down'))
    const lease = await acquirePlatformLease()
    expect(lease).not.toBeNull()
    await expect(lease?.release()).resolves.toBeUndefined()
  })
})

describe('reservePlatformBudget()', () => {
  it('passes straight through while the global budget has room', async () => {
    consumeMock.mockResolvedValue({ ok: true, value: undefined })
    expect(await reservePlatformBudget(500)).toBe(true)
    expect(consumeMock).toHaveBeenCalledWith(expect.anything(), 'global', 500)
  })

  it('waits for the window to reset, then goes through', async () => {
    const sleepFn = vi.fn(async () => {})
    consumeMock
      .mockResolvedValueOnce({
        ok: false,
        error: { code: 'RATE_LIMITED', details: { retryAfterSeconds: 10 } },
      })
      .mockResolvedValueOnce({ ok: true, value: undefined })
    expect(await reservePlatformBudget(1000, { sleepFn })).toBe(true)
    expect(sleepFn).toHaveBeenCalledWith(10_000)
  })

  it('gives up after the max wait so the chunk counts as not checked', async () => {
    const sleepFn = vi.fn(async () => {})
    consumeMock.mockResolvedValue({
      ok: false,
      error: { code: 'RATE_LIMITED', details: { retryAfterSeconds: 40 } },
    })
    expect(
      await reservePlatformBudget(1000, { sleepFn, maxWaitMs: 60_000 }),
    ).toBe(false)
    expect(sleepFn).toHaveBeenCalledTimes(1)
  })
})
