import type {
  WhatsAppConnection,
  WhatsAppMetaSpendSnapshot,
} from '@prisma/client'
import { logFields } from '@/lib/axiom/log-fields'
import { logger } from '@/lib/axiom/logger'
import { WhatsAppMetaSpendCache } from '@/src/cache/whatsapp-meta-spend.cache'
import { ok, type Result } from '@/src/lib/result'
import {
  DEFAULT_CURRENCY,
  referencePriceRows,
  toPriceRows,
} from '@/src/lib/whatsapp/cost'
import { metaCredentialsOf } from '@/src/lib/whatsapp/marketing-lite'
import {
  describeMetaSpendError,
  fetchMetaSpend,
  type MetaSpendReading,
  metaSpendWindow,
} from '@/src/lib/whatsapp/meta-pricing'
import { WhatsAppCostRepository } from '@/src/repositories/whatsapp-cost.repository'
import { WhatsAppSpendCapRepository } from '@/src/repositories/whatsapp-spend-cap.repository'

export interface MetaSpendRefresh {
  /** Snapshot of the current month (fresh, or the last good one). */
  snapshot: WhatsAppMetaSpendSnapshot | null
  /** Meta answered in this call (false = read in the last 60 s, or failed). */
  refreshed: boolean
  /** The Meta call failed: `snapshot` is the previous reading. */
  stale: boolean
  /** pt-BR reason of the failure, for the page. */
  reason: string | null
}

const UNCHANGED: MetaSpendRefresh = {
  snapshot: null,
  refreshed: false,
  stale: false,
  reason: null,
}

const inflight = new Map<string, Promise<Result<MetaSpendRefresh>>>()

async function priceRows(workspaceId: string) {
  const stored = await WhatsAppCostRepository.listPrices(workspaceId)
  return stored.ok && stored.value.length > 0
    ? toPriceRows(stored.value)
    : referencePriceRows()
}

/** Day one of the month: nothing closed yet, the spend so far is zero. */
async function emptyReading(
  connectionId: string,
  now: Date,
): Promise<MetaSpendReading> {
  const window = metaSpendWindow(now)
  const latest =
    await WhatsAppSpendCapRepository.findLatestSnapshot(connectionId)
  const previous = latest.ok ? latest.value : null
  return {
    source: previous?.source ?? 'META_VOLUME',
    cost: 0,
    currency: previous?.currency ?? DEFAULT_CURRENCY,
    byCategory: [],
    periodStart: window.start,
    periodEnd: window.end,
  }
}

async function run(
  connection: WhatsAppConnection,
  now: Date,
): Promise<Result<MetaSpendRefresh>> {
  const { period } = metaSpendWindow(now)
  const stored = () =>
    WhatsAppSpendCapRepository.findSnapshot(connection.id, period)

  if (!(await WhatsAppMetaSpendCache.claim(connection.id))) {
    const last = await stored()
    if (!last.ok) return last
    return ok({ ...UNCHANGED, snapshot: last.value })
  }

  let reading: MetaSpendReading | null
  try {
    const credentials = await metaCredentialsOf(connection)
    if (!credentials) throw new Error('Meta connection without credentials')
    reading = await fetchMetaSpend(
      credentials,
      await priceRows(connection.workspaceId),
      now,
    )
  } catch (error) {
    logger.warn(
      'whatsapp.meta_spend.fetch_failed',
      logFields(
        {
          component: 'WhatsAppMetaSpendService',
          workspaceId: connection.workspaceId,
        },
        {
          connectionId: connection.id,
          reason: error instanceof Error ? error.message : String(error),
        },
      ),
    )
    const last = await stored()
    if (!last.ok) return last
    return ok({
      snapshot: last.value,
      refreshed: false,
      stale: true,
      reason: describeMetaSpendError(error),
    })
  }

  const value = reading ?? (await emptyReading(connection.id, now))
  if (value.costRefusal) {
    logger.info(
      'whatsapp.meta_spend.cost_refused',
      logFields(
        {
          component: 'WhatsAppMetaSpendService',
          workspaceId: connection.workspaceId,
        },
        { connectionId: connection.id, reason: value.costRefusal },
      ),
    )
  }
  const saved = await WhatsAppSpendCapRepository.upsertSnapshot({
    workspaceId: connection.workspaceId,
    connectionId: connection.id,
    month: period,
    cost: value.cost,
    currency: value.currency,
    source: value.source,
    byCategory: value.byCategory.map((row) => ({ ...row })),
    periodStart: value.periodStart,
    periodEnd: value.periodEnd,
    fetchedAt: now,
  })
  if (!saved.ok) return saved
  logger.info(
    'whatsapp.meta_spend.refreshed',
    logFields(
      {
        component: 'WhatsAppMetaSpendService',
        workspaceId: connection.workspaceId,
      },
      { connectionId: connection.id, source: value.source, cost: value.cost },
    ),
  )
  return ok({
    snapshot: saved.value,
    refreshed: true,
    stale: false,
    reason: null,
  })
}

/**
 * Real month spend of a Meta number (ADR 0064), read from the Graph API on
 * page access and by the worker tick. Cached 60 s in Redis (cross-process
 * single flight) plus an in-process single flight; a Meta failure keeps the
 * last snapshot, so the spend never drops to zero.
 */
export const WhatsAppMetaSpendService = {
  async refresh(
    connection: WhatsAppConnection,
    now = new Date(),
  ): Promise<Result<MetaSpendRefresh>> {
    if (connection.provider !== 'META') return ok(UNCHANGED)
    const running = inflight.get(connection.id)
    if (running) return running
    const promise = run(connection, now).finally(() => {
      inflight.delete(connection.id)
    })
    inflight.set(connection.id, promise)
    return promise
  },
}
