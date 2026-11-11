import type {
  WhatsAppConnection,
  WhatsAppMetaSpendSnapshot,
  WhatsAppSpendCap,
  WhatsAppSpendCapMode,
} from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logFields } from '@/lib/axiom/log-fields'
import { logger } from '@/lib/axiom/logger'
import { WhatsAppMetaSpendCache } from '@/src/cache/whatsapp-meta-spend.cache'
import {
  notFound,
  validationError,
  whatsappSpendCapReached,
} from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import {
  type BudgetLevel,
  budgetLevel,
  countryFromWaId,
  normalizeTemplateCategory,
  referencePriceRows,
  resolveUnitPrice,
  roundCents,
  toPriceRows,
} from '@/src/lib/whatsapp/cost'
import { metaSpendWindow } from '@/src/lib/whatsapp/meta-pricing'
import { toWhatsAppSpendCapStatusDTO } from '@/src/mappers/whatsapp-spend-cap.mapper'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppCostRepository } from '@/src/repositories/whatsapp-cost.repository'
import { WhatsAppSpendCapRepository } from '@/src/repositories/whatsapp-spend-cap.repository'
import type {
  UpdateWhatsAppSpendCapDTO,
  WhatsAppSpendCapQueryDTO,
} from '@/src/schemas/whatsapp-spend-cap.schema'
import type { WhatsAppSpendCapStatusDTO } from '@/types/whatsapp-spend-cap'
import { assertModulePrivileged } from './authz'
import { WhatsAppMetaSpendService } from './whatsapp-meta-spend.service'
import { notifyWhatsAppUsers, whatsAppAdminIds } from './whatsapp-notify'

/** State of a number's cap read before a paid send (no Meta call). */
export interface SpendCapCheck {
  connectionId: string
  workspaceId: string
  label: string
  period: string
  cap: number
  capMode: WhatsAppSpendCapMode
  /** Month spend before this message. */
  spent: number
  /** Price of the message about to go out. */
  nextCost: number
}

type ConnectionRef = Pick<WhatsAppConnection, 'id' | 'workspaceId' | 'label'>

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

const COSTS_PATH = '/zap/reports?aba=custos'

function warn(
  event: string,
  workspaceId: string,
  extra: Record<string, unknown>,
) {
  logger.warn(
    event,
    logFields({ component: 'WhatsAppSpendCapService', workspaceId }, extra),
  )
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Month spend of a number: the last Meta snapshot (closed UTC days) plus the
 * Steel ledger since the snapshot's end, or the ledger alone since the month
 * start while Meta was never read.
 */
async function spendOf(
  connectionId: string,
  now: Date,
): Promise<
  Result<{
    period: string
    snapshot: WhatsAppMetaSpendSnapshot | null
    ledger: number
    spent: number
  }>
> {
  const window = metaSpendWindow(now)
  const snapshot = await WhatsAppSpendCapRepository.findSnapshot(
    connectionId,
    window.period,
  )
  if (!snapshot.ok) return snapshot
  const since = snapshot.value?.periodEnd ?? window.start
  const ledger = await WhatsAppSpendCapRepository.sumLedgerSince(
    connectionId,
    since,
  )
  if (!ledger.ok) return ledger
  const meta = snapshot.value ? Number(snapshot.value.cost) : 0
  return ok({
    period: window.period,
    snapshot: snapshot.value,
    ledger: ledger.value,
    spent: meta + ledger.value,
  })
}

/**
 * Notifies OWNER/ADMIN once per level (80/100), number and month — the same
 * pattern and notification kinds as the ADR 0050 budget. Never throws.
 */
async function notifyLevel(
  connection: ConnectionRef,
  cap: { amount: number; capMode: WhatsAppSpendCapMode },
  spent: number,
  period: string,
): Promise<BudgetLevel | null> {
  try {
    const amount = cap.amount
    const level = budgetLevel(spent, amount)
    if (level === null) return null
    const reached = level === 100
    const tail =
      reached && cap.capMode === 'BLOCK'
        ? 'Os envios pagos (templates) deste número estão bloqueados até o limite ser aumentado ou o modo mudar para "só avisar".'
        : 'Os envios continuam normalmente.'
    await notifyWhatsAppUsers({
      workspaceId: connection.workspaceId,
      kind: reached
        ? 'WHATSAPP_COST_BUDGET_REACHED'
        : 'WHATSAPP_COST_BUDGET_WARNING',
      userIds: await whatsAppAdminIds(connection.workspaceId),
      title: reached
        ? `Limite de gasto atingido: ${connection.label}`
        : `${connection.label} em 80% do limite de gasto`,
      body: `${BRL.format(spent)} de ${BRL.format(amount)} neste mês, pelos dados da Meta. ${tail}`,
      path: COSTS_PATH,
      dedupeKey: `whatsapp-spend-cap:${connection.id}:${period}:${level}`,
      meta: { level, period, connectionId: connection.id },
    })
    return level
  } catch (error) {
    warn('whatsapp.spend_cap.notify_failed', connection.workspaceId, {
      connectionId: connection.id,
      reason: reasonOf(error),
    })
    return null
  }
}

async function statusOf(
  connection: WhatsAppConnection,
  cap: WhatsAppSpendCap | null,
  now: Date,
  refresh: { stale: boolean; reason: string | null },
): Promise<Result<WhatsAppSpendCapStatusDTO>> {
  const spend = await spendOf(connection.id, now)
  if (!spend.ok) return spend
  if (cap) {
    await notifyLevel(
      connection,
      { amount: Number(cap.monthlyCapAmount), capMode: cap.capMode },
      spend.value.spent,
      spend.value.period,
    )
  }
  return ok(
    toWhatsAppSpendCapStatusDTO({
      connection,
      cap,
      snapshot: spend.value.snapshot,
      ledgerSpent: spend.value.ledger,
      period: spend.value.period,
      now,
      stale: refresh.stale,
      staleReason: refresh.reason,
    }),
  )
}

/**
 * Monthly spending cap per WhatsApp number (ADR 0064). The month spend
 * comes from Meta (snapshot of the closed days) plus the Steel ledger for
 * the part Meta has not reported. `BLOCK` refuses paid template sends that
 * would cross the cap; service replies are never blocked. Money is visible
 * to OWNER/ADMIN only.
 */
export const WhatsAppSpendCapService = {
  /**
   * Hot path, before a paid Meta template send (`WhatsAppSend`): reads the
   * cap, the stored snapshot and the ledger — never calls Meta. `ok(null)`
   * when the number has no cap.
   */
  async checkSend(
    connection: ConnectionRef,
    input: {
      to: string
      templateCategory?: string | null
      lite?: boolean
    },
    now = new Date(),
  ): Promise<Result<SpendCapCheck | null>> {
    const cap = await WhatsAppSpendCapRepository.findCap(connection.id)
    if (!cap.ok) return cap
    if (!cap.value) return ok(null)

    const [spend, prices] = await Promise.all([
      spendOf(connection.id, now),
      WhatsAppCostRepository.listPrices(connection.workspaceId),
    ])
    if (!spend.ok) return spend
    const rows =
      prices.ok && prices.value.length > 0
        ? toPriceRows(prices.value)
        : referencePriceRows()
    const nextCost = resolveUnitPrice(
      rows,
      normalizeTemplateCategory(input.templateCategory),
      countryFromWaId(input.to),
      now,
      { lite: input.lite === true },
    ).unitPrice
    const amount = Number(cap.value.monthlyCapAmount)
    const spent = spend.value.spent

    if (cap.value.capMode === 'BLOCK' && spent + nextCost > amount) {
      logger.info(
        'whatsapp.spend_cap.send_blocked',
        logFields(
          {
            component: 'WhatsAppSpendCapService',
            workspaceId: connection.workspaceId,
          },
          { connectionId: connection.id, spent, cap: amount, nextCost },
        ),
      )
      return err(whatsappSpendCapReached(amount, roundCents(spent)))
    }
    return ok({
      connectionId: connection.id,
      workspaceId: connection.workspaceId,
      label: connection.label,
      period: spend.value.period,
      cap: amount,
      capMode: cap.value.capMode,
      spent,
      nextCost,
    })
  },

  /** After the provider accepted a paid send: 80/100% notices. Never throws. */
  async afterSend(check: SpendCapCheck): Promise<void> {
    await notifyLevel(
      {
        id: check.connectionId,
        workspaceId: check.workspaceId,
        label: check.label,
      },
      { amount: check.cap, capMode: check.capMode },
      check.spent + check.nextCost,
      check.period,
    )
  },

  /**
   * Status webhook said `failed`: Meta does not bill it, so the ledger entry
   * of that message is zeroed. Never throws (the webhook must not fail).
   */
  async onMessageFailed(
    providerMessageId: string,
    now = new Date(),
  ): Promise<void> {
    try {
      const reversed = await WhatsAppSpendCapRepository.reverseFailedEntries(
        providerMessageId,
        now,
      )
      if (!reversed.ok) {
        logger.warn('whatsapp.spend_cap.reverse_failed', {
          component: 'WhatsAppSpendCapService',
          providerMessageId,
          reason: reversed.error.code,
        })
      }
    } catch (error) {
      logger.warn('whatsapp.spend_cap.reverse_failed', {
        component: 'WhatsAppSpendCapService',
        providerMessageId,
        reason: reasonOf(error),
      })
    }
  },

  /**
   * Costs page / connection settings: refreshes each Meta number from the
   * Graph API (60 s cache) and returns the month spend against the cap.
   */
  async list(
    actorId: string,
    workspaceId: string,
    query: WhatsAppSpendCapQueryDTO = {},
    now = new Date(),
  ): Promise<Result<WhatsAppSpendCapStatusDTO[]>> {
    const access = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!access.ok) return access

    const [connections, caps] = await Promise.all([
      WhatsAppSpendCapRepository.listMetaConnections(workspaceId),
      WhatsAppSpendCapRepository.listCaps(workspaceId),
    ])
    if (!connections.ok) return connections
    if (!caps.ok) return caps
    const capOf = new Map(caps.value.map((cap) => [cap.connectionId, cap]))
    const selected = connections.value.filter(
      (connection) =>
        !query.connectionId || connection.id === query.connectionId,
    )

    const rows = await Promise.all(
      selected.map(async (connection) => {
        const refresh = await WhatsAppMetaSpendService.refresh(connection, now)
        if (!refresh.ok) return refresh
        return statusOf(connection, capOf.get(connection.id) ?? null, now, {
          stale: refresh.value.stale,
          reason: refresh.value.reason,
        })
      }),
    )
    const result: WhatsAppSpendCapStatusDTO[] = []
    for (const row of rows) {
      if (!row.ok) return row
      result.push(row.value)
    }
    return ok(result)
  },

  /** Sets (or removes, with `null`) the cap of a Meta number. Audited. */
  async update(
    actorId: string,
    workspaceId: string,
    connectionId: string,
    dto: UpdateWhatsAppSpendCapDTO,
    now = new Date(),
  ): Promise<Result<WhatsAppSpendCapStatusDTO>> {
    const access = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!access.ok) return access

    const connection = await WhatsAppConnectionRepository.findById(
      connectionId,
      workspaceId,
    )
    if (!connection.ok) return connection
    if (!connection.value) return err(notFound('Conexão'))
    if (connection.value.provider !== 'META') {
      return err(
        validationError(
          'O limite de gasto vale só para números da API oficial da Meta',
        ),
      )
    }

    let cap: WhatsAppSpendCap | null = null
    if (dto.monthlyCapAmount === null) {
      const removed = await WhatsAppSpendCapRepository.deleteCap(
        workspaceId,
        connectionId,
      )
      if (!removed.ok) return removed
    } else {
      const saved = await WhatsAppSpendCapRepository.upsertCap({
        workspaceId,
        connectionId,
        monthlyCapAmount: dto.monthlyCapAmount,
        capMode: dto.capMode,
        updatedById: actorId,
      })
      if (!saved.ok) return saved
      cap = saved.value
    }

    auditMutation({
      entity: 'whatsapp_spend_cap',
      action: cap ? 'update' : 'delete',
      actorId,
      targetId: connectionId,
      meta: {
        workspaceId,
        monthlyCapAmount: dto.monthlyCapAmount,
        capMode: dto.capMode,
      },
    })
    // The next page access reads Meta again with the new cap in place.
    await WhatsAppMetaSpendCache.release(connectionId)
    return statusOf(connection.value, cap, now, { stale: false, reason: null })
  },

  /**
   * Worker tick (`whatsapp-meta-spend`, every 15 min): refreshes every
   * capped number so the block works when nobody opens the page. Never
   * throws; failures are counted and logged.
   */
  async refreshTick(
    now = new Date(),
  ): Promise<{ connections: number; refreshed: number; failed: number }> {
    const capped = await WhatsAppSpendCapRepository.listCappedConnections()
    if (!capped.ok) {
      logger.warn('whatsapp.spend_cap.tick_failed', {
        component: 'WhatsAppSpendCapService',
        reason: capped.error.code,
      })
      return { connections: 0, refreshed: 0, failed: 0 }
    }
    let refreshed = 0
    let failed = 0
    for (const connection of capped.value) {
      const refresh = await WhatsAppMetaSpendService.refresh(connection, now)
      if (!refresh.ok) {
        failed += 1
        continue
      }
      if (refresh.value.stale) failed += 1
      if (refresh.value.refreshed) refreshed += 1
      // Even on a stale read the ledger keeps growing: re-check the levels.
      const cap = await WhatsAppSpendCapRepository.findCap(connection.id)
      if (cap.ok && cap.value) {
        await statusOf(connection, cap.value, now, refresh.value)
      }
    }
    return { connections: capped.value.length, refreshed, failed }
  },
}
