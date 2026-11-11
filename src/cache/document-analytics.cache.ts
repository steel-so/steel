import { logger } from '@/lib/axiom/logger'
import { type AppError, appError } from '@/src/errors/app-error'
import { ensureRedisConnected } from '@/src/lib/redis'
import { err, ok, type Result } from '@/src/lib/result'

/**
 * Redis side of the document reading analytics (ADR 0063):
 *
 * - **buffer** (`doc:analytics:buffer`, one hash): the beacons of the public
 *   link only increment counters here; the `documents-analytics` worker
 *   moves them to Postgres every minute. Fields:
 *   `s|<sessionId>|ms` (active ms), `s|<sessionId>|scroll` (max %),
 *   `s|<sessionId>|end` (`1`), `s|<sessionId>|seen` (epoch ms),
 *   `x|<sessionId>|<sectionId>|ms`, `x|…|v` (views), `x|…|at` (first seen).
 * - **flush**: the worker RENAMEs the buffer to `doc:analytics:flushing`,
 *   writes it to Postgres in one transaction and only then deletes it. A
 *   failed write leaves the key for the retry (never applied twice: the
 *   transaction rolled back); new beacons keep landing in a fresh buffer.
 *   A lock keeps two flushes from reading the same key.
 * - **session map** `doc:analytics:session:<documentId>:<sessionKey>` →
 *   session id, so a beacon does not hit Postgres to find its session.
 * - **dedupe** keys for the "abriu agora" notification (30 min per reader),
 *   the FORWARDED event (once per visitor) and the per-session event cap.
 *
 * Read helpers fail soft (a beacon is never refused because Redis hiccuped);
 * the flush returns `err` so the job retries.
 */

const PREFIX = 'doc:analytics'
export const DOCUMENT_ANALYTICS_BUFFER_KEY = `${PREFIX}:buffer`
export const DOCUMENT_ANALYTICS_FLUSHING_KEY = `${PREFIX}:flushing`
const FLUSH_LOCK_KEY = `${PREFIX}:flush-lock`
const FLUSH_LOCK_SECONDS = 55
const SESSION_TTL_SECONDS = 6 * 60 * 60
export const DOCUMENT_VIEW_NOTIFY_WINDOW_SECONDS = 30 * 60
const FORWARD_TTL_SECONDS = 180 * 24 * 60 * 60
const EVENT_WINDOW_SECONDS = 60 * 60
/** Events (clicks, plays, downloads) stored per session per hour. */
export const DOCUMENT_EVENTS_PER_SESSION_HOUR = 60

export interface DocumentReadIncrement {
  sessionId: string
  activeMs: number
  /** Active ms per section id. */
  sections: Record<string, number>
  /** Sections that became visible (views). */
  entered: string[]
  scrollPct: number
  reachedEnd: boolean
  seenAt: Date
}

export interface DocumentSessionDelta {
  sessionId: string
  activeMs: number
  maxScrollPct: number
  reachedEnd: boolean
  lastSeenAt: Date | null
}

export interface DocumentSectionDelta {
  sessionId: string
  sectionId: string
  activeMs: number
  views: number
  firstSeenAt: Date | null
}

export interface DocumentReadBatch {
  sessions: DocumentSessionDelta[]
  sections: DocumentSectionDelta[]
}

function sessionMapKey(documentId: string, sessionKey: string): string {
  return `${PREFIX}:session:${documentId}:${sessionKey}`
}

function warn(event: string, cause: unknown) {
  logger.warn(event, {
    component: 'DocumentAnalyticsCache',
    message: cause instanceof Error ? cause.message : String(cause),
  })
}

function cacheError(message: string, cause: unknown): AppError {
  warn('cache.document_analytics.flush_failed', cause)
  return appError('INTERNAL_SERVER_ERROR', message)
}

const toInt = (value: string | undefined) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0
}

const toDate = (value: string | undefined) => {
  const ms = Number(value)
  return value && Number.isFinite(ms) && ms > 0 ? new Date(ms) : null
}

/** Parses the buffer hash into per-session and per-section deltas. */
export function parseReadBuffer(
  fields: Record<string, string>,
): DocumentReadBatch {
  const sessions = new Map<string, DocumentSessionDelta>()
  const sections = new Map<string, DocumentSectionDelta>()

  const sessionOf = (sessionId: string) => {
    let entry = sessions.get(sessionId)
    if (!entry) {
      entry = {
        sessionId,
        activeMs: 0,
        maxScrollPct: 0,
        reachedEnd: false,
        lastSeenAt: null,
      }
      sessions.set(sessionId, entry)
    }
    return entry
  }

  for (const [field, value] of Object.entries(fields)) {
    const parts = field.split('|')
    if (parts.length < 3) continue
    const [kind, sessionId] = parts
    const metric = parts[parts.length - 1]
    if (!sessionId) continue

    if (kind === 's' && parts.length === 3) {
      const entry = sessionOf(sessionId)
      if (metric === 'ms') entry.activeMs = toInt(value)
      else if (metric === 'scroll') entry.maxScrollPct = toInt(value)
      else if (metric === 'end') entry.reachedEnd = value === '1'
      else if (metric === 'seen') entry.lastSeenAt = toDate(value)
      continue
    }

    if (kind !== 'x' || parts.length < 4) continue
    const sectionId = parts.slice(2, -1).join('|')
    if (!sectionId) continue
    const key = `${sessionId}|${sectionId}`
    let entry = sections.get(key)
    if (!entry) {
      entry = { sessionId, sectionId, activeMs: 0, views: 0, firstSeenAt: null }
      sections.set(key, entry)
    }
    if (metric === 'ms') entry.activeMs = toInt(value)
    else if (metric === 'v') entry.views = toInt(value)
    else if (metric === 'at') entry.firstSeenAt = toDate(value)
    // A section seen in this window means its session moved too.
    sessionOf(sessionId)
  }

  return { sessions: [...sessions.values()], sections: [...sections.values()] }
}

export const DocumentAnalyticsCache = {
  async getSessionId(
    documentId: string,
    sessionKey: string,
  ): Promise<string | null> {
    try {
      const client = await ensureRedisConnected()
      return await client.get(sessionMapKey(documentId, sessionKey))
    } catch (cause) {
      warn('cache.document_analytics.get_session_failed', cause)
      return null
    }
  },

  async rememberSession(
    documentId: string,
    sessionKey: string,
    sessionId: string,
  ): Promise<void> {
    try {
      const client = await ensureRedisConnected()
      await client.set(sessionMapKey(documentId, sessionKey), sessionId, {
        EX: SESSION_TTL_SECONDS,
      })
    } catch (cause) {
      warn('cache.document_analytics.remember_session_failed', cause)
    }
  },

  /** Adds one beacon to the buffer (atomic MULTI). `false` on failure. */
  async bufferRead(increment: DocumentReadIncrement): Promise<boolean> {
    try {
      const client = await ensureRedisConnected()
      const key = DOCUMENT_ANALYTICS_BUFFER_KEY
      const s = `s|${increment.sessionId}`
      const tx = client.multi()
      if (increment.activeMs > 0) {
        tx.hIncrBy(key, `${s}|ms`, increment.activeMs)
      }
      // The tracker always reports the max so far; the flush keeps the
      // greatest value stored (GREATEST), so the last one is enough here.
      tx.hSet(key, `${s}|scroll`, String(increment.scrollPct))
      const seen = String(increment.seenAt.getTime())
      tx.hSet(key, `${s}|seen`, seen)
      if (increment.reachedEnd) tx.hSet(key, `${s}|end`, '1')
      for (const [sectionId, ms] of Object.entries(increment.sections)) {
        if (ms <= 0) continue
        const x = `x|${increment.sessionId}|${sectionId}`
        tx.hIncrBy(key, `${x}|ms`, ms)
        tx.hSetNX(key, `${x}|at`, seen)
      }
      for (const sectionId of increment.entered) {
        const x = `x|${increment.sessionId}|${sectionId}`
        tx.hIncrBy(key, `${x}|v`, 1)
        tx.hSetNX(key, `${x}|at`, seen)
      }
      await tx.exec()
      return true
    } catch (cause) {
      warn('cache.document_analytics.buffer_failed', cause)
      return false
    }
  },

  /** `true` once per reader per 30 min ("abriu agora" notification). */
  async claimViewNotification(
    documentId: string,
    reader: string,
  ): Promise<boolean> {
    try {
      const client = await ensureRedisConnected()
      const set = await client.set(
        `${PREFIX}:notify:${documentId}:${reader}`,
        '1',
        { NX: true, EX: DOCUMENT_VIEW_NOTIFY_WINDOW_SECONDS },
      )
      return set === 'OK'
    } catch (cause) {
      warn('cache.document_analytics.claim_notify_failed', cause)
      return false
    }
  },

  /** `true` the first time a visitor shows up on someone's personal link. */
  async claimForward(recipientId: string, visitorId: string): Promise<boolean> {
    try {
      const client = await ensureRedisConnected()
      const set = await client.set(
        `${PREFIX}:forward:${recipientId}:${visitorId}`,
        '1',
        { NX: true, EX: FORWARD_TTL_SECONDS },
      )
      return set === 'OK'
    } catch (cause) {
      warn('cache.document_analytics.claim_forward_failed', cause)
      return false
    }
  },

  /** How many of `count` new events the session may still store. */
  async reserveEvents(sessionId: string, count: number): Promise<number> {
    if (count <= 0) return 0
    try {
      const client = await ensureRedisConnected()
      const key = `${PREFIX}:events:${sessionId}`
      const total = await client.incrBy(key, count)
      if (total === count) await client.expire(key, EVENT_WINDOW_SECONDS)
      const before = total - count
      return Math.max(
        0,
        Math.min(count, DOCUMENT_EVENTS_PER_SESSION_HOUR - before),
      )
    } catch (cause) {
      warn('cache.document_analytics.reserve_events_failed', cause)
      return 0
    }
  },

  /**
   * Takes the buffer for a flush: a batch left by a failed attempt first,
   * otherwise the current buffer (renamed). `null` when another flush holds
   * the lock.
   */
  async takeBatch(): Promise<Result<DocumentReadBatch | null>> {
    try {
      const client = await ensureRedisConnected()
      const locked = await client.set(FLUSH_LOCK_KEY, '1', {
        NX: true,
        EX: FLUSH_LOCK_SECONDS,
      })
      if (locked !== 'OK') return ok(null)

      const pending = await client.exists(DOCUMENT_ANALYTICS_FLUSHING_KEY)
      if (!pending) {
        const hasBuffer = await client.exists(DOCUMENT_ANALYTICS_BUFFER_KEY)
        if (!hasBuffer) return ok({ sessions: [], sections: [] })
        await client.rename(
          DOCUMENT_ANALYTICS_BUFFER_KEY,
          DOCUMENT_ANALYTICS_FLUSHING_KEY,
        )
      }
      const fields = await client.hGetAll(DOCUMENT_ANALYTICS_FLUSHING_KEY)
      return ok(parseReadBuffer(fields))
    } catch (cause) {
      return err(
        cacheError('Failed to read the document analytics buffer', cause),
      )
    }
  },

  /** Drops the flushed batch and releases the lock. */
  async ackBatch(): Promise<Result<void>> {
    try {
      const client = await ensureRedisConnected()
      await client.del([DOCUMENT_ANALYTICS_FLUSHING_KEY, FLUSH_LOCK_KEY])
      return ok(undefined)
    } catch (cause) {
      return err(
        cacheError('Failed to drop the flushed analytics batch', cause),
      )
    }
  },

  /** Releases the lock and keeps the batch for the retry. */
  async releaseBatch(): Promise<void> {
    try {
      const client = await ensureRedisConnected()
      await client.del(FLUSH_LOCK_KEY)
    } catch (cause) {
      warn('cache.document_analytics.release_failed', cause)
    }
  },
}
