import { logger } from '@/lib/axiom/logger'
import type { AiProviderId } from '../models'

/**
 * Circuit breaker of the AI providers, shared by every app replica and the
 * worker through Redis (ADR 0042). After `FAILURE_THRESHOLD` provider
 * failures inside `FAILURE_WINDOW_S`, the provider is "open" for `OPEN_S`:
 * calls go straight to the fallback model instead of waiting on a timeout
 * again. When the open key expires the next call tries the provider again
 * (half-open); a success clears the failure count.
 *
 * The breaker never fails a call: if Redis is slow or down it answers
 * "closed" and the failover still happens per call.
 */

export const FAILURE_THRESHOLD = 5
export const FAILURE_WINDOW_S = 60
export const OPEN_S = 60
/** Redis gets this long per operation before the breaker gives up on it. */
const STORE_TIMEOUT_MS = 300

export interface CircuitBreakerStore {
  /** Increments the counter (TTL set on the first increment: a fixed window). */
  incr(key: string, ttlSeconds: number): Promise<number>
  set(key: string, ttlSeconds: number): Promise<void>
  exists(key: string): Promise<boolean>
  del(key: string): Promise<void>
}

const failKey = (provider: AiProviderId) => `ai:cb:fail:${provider}`
const openKey = (provider: AiProviderId) => `ai:cb:open:${provider}`

async function bounded<T>(work: Promise<T>, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), STORE_TIMEOUT_MS)
      }),
    ])
  } catch (error) {
    logger.warn('ai.circuit_breaker.store_failed', {
      component: 'AiCircuitBreaker',
      message: error instanceof Error ? error.message : String(error),
    })
    return fallback
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export interface AiCircuitBreaker {
  isOpen(provider: AiProviderId): Promise<boolean>
  recordFailure(provider: AiProviderId): Promise<void>
  recordSuccess(provider: AiProviderId): Promise<void>
}

export function createCircuitBreaker(
  store: CircuitBreakerStore,
): AiCircuitBreaker {
  return {
    isOpen(provider) {
      return bounded(store.exists(openKey(provider)), false)
    },
    async recordFailure(provider) {
      const count = await bounded(
        store.incr(failKey(provider), FAILURE_WINDOW_S),
        0,
      )
      if (count >= FAILURE_THRESHOLD) {
        await bounded(store.set(openKey(provider), OPEN_S), undefined)
        logger.warn('ai.circuit_breaker.opened', {
          component: 'AiCircuitBreaker',
          provider,
          failures: count,
          openSeconds: OPEN_S,
        })
      }
    },
    async recordSuccess(provider) {
      await bounded(store.del(failKey(provider)), undefined)
    },
  }
}

let shared: AiCircuitBreaker | null = null

/** The Redis-backed breaker (lazy: the Redis module is loaded on first use). */
export function getAiCircuitBreaker(): AiCircuitBreaker {
  if (shared) return shared
  const client = async () => {
    const { ensureRedisConnected } = await import('@/src/lib/redis')
    return ensureRedisConnected()
  }
  shared = createCircuitBreaker({
    async incr(key, ttlSeconds) {
      const redis = await client()
      const value = await redis.incr(key)
      if (value === 1) await redis.expire(key, ttlSeconds)
      return value
    },
    async set(key, ttlSeconds) {
      const redis = await client()
      await redis.set(key, '1', { EX: ttlSeconds })
    },
    async exists(key) {
      const redis = await client()
      return (await redis.exists(key)) > 0
    },
    async del(key) {
      const redis = await client()
      await redis.del(key)
    },
  })
  return shared
}
