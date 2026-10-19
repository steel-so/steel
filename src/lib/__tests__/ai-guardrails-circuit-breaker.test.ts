import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
const redis = {
  incr: vi.fn(),
  expire: vi.fn(),
  set: vi.fn(),
  exists: vi.fn(),
  del: vi.fn(),
}
vi.mock('@/src/lib/redis', () => ({
  ensureRedisConnected: vi.fn(async () => redis),
}))

import { logger } from '@/lib/axiom/logger'
import {
  type CircuitBreakerStore,
  createCircuitBreaker,
  FAILURE_THRESHOLD,
  getAiCircuitBreaker,
  OPEN_S,
} from '@/src/lib/ai/guardrails/circuit-breaker'

function memoryStore(): CircuitBreakerStore & { keys: Map<string, number> } {
  const keys = new Map<string, number>()
  return {
    keys,
    async incr(key) {
      const next = (keys.get(key) ?? 0) + 1
      keys.set(key, next)
      return next
    },
    async set(key) {
      keys.set(key, 1)
    },
    async exists(key) {
      return keys.has(key)
    },
    async del(key) {
      keys.delete(key)
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createCircuitBreaker()', () => {
  it('should open after the threshold and clear the count on success', async () => {
    const store = memoryStore()
    const breaker = createCircuitBreaker(store)
    for (let i = 0; i < FAILURE_THRESHOLD - 1; i++) {
      await breaker.recordFailure('openai')
    }
    expect(await breaker.isOpen('openai')).toBe(false)
    await breaker.recordFailure('openai')
    expect(await breaker.isOpen('openai')).toBe(true)
    expect(await breaker.isOpen('anthropic')).toBe(false)
    expect(logger.warn).toHaveBeenCalledWith(
      'ai.circuit_breaker.opened',
      expect.objectContaining({ provider: 'openai', openSeconds: OPEN_S }),
    )
    await breaker.recordSuccess('openai')
    expect(store.keys.has('ai:cb:fail:openai')).toBe(false)
  })

  it('should answer closed when the store fails or hangs', async () => {
    const failing = createCircuitBreaker({
      incr: async () => {
        throw new Error('redis down')
      },
      set: async () => undefined,
      exists: () => new Promise(() => {}),
      del: async () => undefined,
    })
    await failing.recordFailure('openai')
    expect(logger.warn).toHaveBeenCalledWith(
      'ai.circuit_breaker.store_failed',
      expect.objectContaining({ message: 'redis down' }),
    )
    await expect(failing.isOpen('openai')).resolves.toBe(false)
  })

  it('should log non-Error store failures too', async () => {
    const breaker = createCircuitBreaker({
      incr: async () => 0,
      set: async () => undefined,
      exists: async () => {
        throw 'nope'
      },
      del: async () => undefined,
    })
    expect(await breaker.isOpen('openai')).toBe(false)
    expect(logger.warn).toHaveBeenCalledWith(
      'ai.circuit_breaker.store_failed',
      expect.objectContaining({ message: 'nope' }),
    )
  })
})

describe('getAiCircuitBreaker()', () => {
  it('should talk to Redis and be a singleton', async () => {
    const breaker = getAiCircuitBreaker()
    expect(getAiCircuitBreaker()).toBe(breaker)

    redis.incr.mockResolvedValueOnce(1)
    await breaker.recordFailure('anthropic')
    expect(redis.expire).toHaveBeenCalledWith('ai:cb:fail:anthropic', 60)

    redis.incr.mockResolvedValueOnce(FAILURE_THRESHOLD)
    await breaker.recordFailure('anthropic')
    expect(redis.set).toHaveBeenCalledWith('ai:cb:open:anthropic', '1', {
      EX: OPEN_S,
    })

    redis.exists.mockResolvedValueOnce(1)
    expect(await breaker.isOpen('anthropic')).toBe(true)
    redis.exists.mockResolvedValueOnce(0)
    expect(await breaker.isOpen('anthropic')).toBe(false)

    await breaker.recordSuccess('anthropic')
    expect(redis.del).toHaveBeenCalledWith('ai:cb:fail:anthropic')
  })
})
