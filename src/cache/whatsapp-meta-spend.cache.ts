import { logger } from '@/lib/axiom/logger'
import { ensureRedisConnected } from '@/src/lib/redis'

/**
 * Freshness marker of a number's Meta spend read (ADR 0064):
 * `whatsapp:meta-spend:fresh:<connectionId>` with `SET NX` and a 60 s TTL.
 * The first caller in the window reads Meta; reloads of the costs page, the
 * connection settings and the worker tick inside the same minute reuse the
 * stored snapshot. It is also the cross-process single flight.
 *
 * Redis down **does not** block the read: the caller goes to Meta (a few
 * extra Graph calls are better than a stale cap).
 */

const FRESH_TTL_SECONDS = 60

function key(connectionId: string): string {
  return `whatsapp:meta-spend:fresh:${connectionId}`
}

export const WhatsAppMetaSpendCache = {
  /** `true` when nobody read Meta for this number in the last 60 s. */
  async claim(connectionId: string): Promise<boolean> {
    try {
      const client = await ensureRedisConnected()
      const set = await client.set(key(connectionId), '1', {
        NX: true,
        EX: FRESH_TTL_SECONDS,
      })
      return set === 'OK'
    } catch (cause) {
      logger.warn('whatsapp.meta_spend.cache_unavailable', {
        component: 'WhatsAppMetaSpendCache',
        connectionId,
        message: cause instanceof Error ? cause.message : String(cause),
      })
      return true
    }
  },

  /** Forgets the marker so the next read goes to Meta (cap just changed). */
  async release(connectionId: string): Promise<void> {
    try {
      const client = await ensureRedisConnected()
      await client.del(key(connectionId))
    } catch (cause) {
      logger.warn('whatsapp.meta_spend.cache_release_failed', {
        component: 'WhatsAppMetaSpendCache',
        connectionId,
        message: cause instanceof Error ? cause.message : String(cause),
      })
    }
  },
}
