import { randomUUID } from 'node:crypto'
import { logger } from '@/lib/axiom/logger'
import { consume, zapiPlatformCheckLimiter } from '@/src/lib/rate-limit'
import { ensureRedisConnected, redis } from '@/src/lib/redis'

// Protects the ONE Z-API instance of the platform, which answers the
// "has WhatsApp?" check of every tenant (ADR 0069). Two guards, both shared by
// all workspaces and all app/worker processes through Redis:
//   1. a lease with a few slots: only N validations hit the instance at once;
//   2. a numbers-per-minute budget, consumed before every chunk.
// Both fail OPEN on a Redis outage (the check is not critical enough to stop
// the product) — the per-chunk pause in the Z-API client still applies.

export const PLATFORM_VALIDATION_MAX_CONCURRENT = 2
const LEASE_TTL_MS = 10 * 60 * 1000
const leaseKey = (slot: number) => `whatsapp:validation:platform:slot:${slot}`
/** A chunk waits at most this long for budget before it counts as unchecked. */
const BUDGET_MAX_WAIT_MS = 90 * 1000
const DEFAULT_RETRY_SECONDS = 5

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

export interface PlatformLease {
  /** Extends the lease while a long run is still going. */
  renew(): Promise<void>
  release(): Promise<void>
}

/** Takes a free slot of the shared instance, or null when all are busy. */
export async function acquirePlatformLease(): Promise<PlatformLease | null> {
  const token = randomUUID()
  try {
    await ensureRedisConnected()
    for (let slot = 0; slot < PLATFORM_VALIDATION_MAX_CONCURRENT; slot++) {
      const taken = await redis.set(leaseKey(slot), token, {
        NX: true,
        PX: LEASE_TTL_MS,
      })
      if (taken !== 'OK') continue
      return {
        async renew() {
          try {
            if ((await redis.get(leaseKey(slot))) === token) {
              await redis.pExpire(leaseKey(slot), LEASE_TTL_MS)
            }
          } catch {
            // best effort
          }
        },
        async release() {
          try {
            if ((await redis.get(leaseKey(slot))) === token) {
              await redis.del(leaseKey(slot))
            }
          } catch {
            // the TTL frees the slot anyway
          }
        },
      }
    }
    return null
  } catch (error) {
    logger.error('whatsapp.validation.lease_store_error', {
      component: 'ValidationThrottle',
      reason: error instanceof Error ? error.message : 'unknown',
    })
    // Fail open: behave as if a slot was free.
    return { renew: async () => {}, release: async () => {} }
  }
}

/**
 * Waits for room in the platform-wide numbers-per-minute budget. Returns false
 * when the budget did not free up in time: the caller must leave those numbers
 * "not checked" (never "no WhatsApp").
 */
export async function reservePlatformBudget(
  numbers: number,
  options: { maxWaitMs?: number; sleepFn?: (ms: number) => Promise<void> } = {},
): Promise<boolean> {
  const maxWaitMs = options.maxWaitMs ?? BUDGET_MAX_WAIT_MS
  const wait = options.sleepFn ?? sleep
  let waited = 0
  for (;;) {
    const result = await consume(zapiPlatformCheckLimiter, 'global', numbers)
    if (result.ok) return true
    const details = result.error.details as
      | { retryAfterSeconds?: number }
      | undefined
    const retryMs = (details?.retryAfterSeconds ?? DEFAULT_RETRY_SECONDS) * 1000
    if (waited + retryMs > maxWaitMs) return false
    await wait(retryMs)
    waited += retryMs
  }
}
