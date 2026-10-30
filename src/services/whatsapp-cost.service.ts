import type { WhatsAppConnection, WhatsAppCostSource } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logFields } from '@/lib/axiom/log-fields'
import { logger } from '@/lib/axiom/logger'
import { notFound, whatsappPriceNotFound } from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import {
  BILLABLE_CATEGORIES,
  type BillableCategory,
  budgetLevel,
  countryFromWaId,
  DEFAULT_COUNTRY,
  DEFAULT_CURRENCY,
  daysInPeriod,
  monthBounds,
  multiplyMoney,
  normalizeTemplateCategory,
  type PriceRow,
  projectMonthCost,
  proratedFee,
  REFERENCE_PRICES,
  REFERENCE_VALID_FROM,
  rangeBounds,
  resolveUnitPrice,
  roundCents,
  safeRatio,
  saoPauloDay,
} from '@/src/lib/whatsapp/cost'
import type { WhatsAppCostContext } from '@/src/lib/whatsapp/types'
import { whatsappUsagePeriod } from '@/src/lib/whatsapp/usage-period'
import {
  type CostGroupRow,
  type CostRangeFilter,
  WhatsAppCostRepository,
} from '@/src/repositories/whatsapp-cost.repository'
import { WhatsAppSettingsRepository } from '@/src/repositories/whatsapp-settings.repository'
import type {
  CreateWhatsAppPriceDTO,
  UpdateWhatsAppCostSettingsDTO,
  WhatsAppCostQueryDTO,
} from '@/src/schemas/whatsapp-cost.schema'
import type {
  WhatsAppCostBreakdownRowDTO,
  WhatsAppCostConnectionRowDTO,
  WhatsAppCostProviderRowDTO,
  WhatsAppCostReportDTO,
  WhatsAppCostSettingsDTO,
  WhatsAppPriceDTO,
} from '@/types/whatsapp-cost'
import { assertModulePrivileged } from './authz'
import { notifyWhatsAppUsers, whatsAppAdminIds } from './whatsapp-notify'

const BREAKDOWN_LIMIT = 50

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

function toPriceDTO(row: {
  id: string
  category: string
  country: string
  currency: string
  unitPrice: { toString(): string } | number
  liteUnitPrice?: { toString(): string } | number | null
  validFrom: Date
  reference: boolean
}): WhatsAppPriceDTO {
  return {
    id: row.id,
    category: row.category as WhatsAppPriceDTO['category'],
    country: row.country,
    currency: row.currency,
    unitPrice: Number(row.unitPrice),
    liteUnitPrice: row.liteUnitPrice == null ? null : Number(row.liteUnitPrice),
    validFrom: row.validFrom.toISOString(),
    reference: row.reference,
  }
}

function toPriceRows(
  rows: {
    category: string
    country: string
    currency: string
    unitPrice: { toString(): string } | number
    liteUnitPrice?: { toString(): string } | number | null
    validFrom: Date
  }[],
): PriceRow[] {
  return rows.map((row) => ({
    category: row.category as PriceRow['category'],
    country: row.country,
    currency: row.currency,
    unitPrice: Number(row.unitPrice),
    liteUnitPrice: row.liteUnitPrice == null ? null : Number(row.liteUnitPrice),
    validFrom: row.validFrom,
  }))
}

/** The labeled default, used while a workspace has no rows of its own. */
function referenceRows(): PriceRow[] {
  return BILLABLE_CATEGORIES.map((category) => ({
    category,
    country: DEFAULT_COUNTRY,
    currency: DEFAULT_CURRENCY,
    unitPrice: REFERENCE_PRICES[category],
    validFrom: REFERENCE_VALID_FROM,
  }))
}

function breakdown(
  rows: CostGroupRow[],
  label: (key: string) => string,
): WhatsAppCostBreakdownRowDTO[] {
  return rows
    .filter((row) => row.key !== null)
    .map((row) => ({
      key: row.key as string,
      label: label(row.key as string),
      messages: row.messages,
      cost: roundCents(row.cost),
    }))
    .sort((a, b) => b.cost - a.cost || b.messages - a.messages)
    .slice(0, BREAKDOWN_LIMIT)
}

const CATEGORY_LABEL: Record<string, string> = {
  MARKETING: 'Marketing',
  UTILITY: 'Utilidade',
  AUTHENTICATION: 'Autenticação',
  SERVICE: 'Atendimento (janela de 24 h)',
}

const SOURCE_LABEL: Record<string, string> = {
  BROADCAST: 'Transmissões',
  AI_CAMPAIGN: 'Campanhas de IA',
  CRM_CAMPAIGN: 'Campanhas do CRM',
  AGENT: 'Atendentes',
  AI_REPLY: 'Respostas da IA',
  BUTTON: 'Botões',
  OTHER: 'Outros',
}

function csvCell(value: string | number): string {
  const text =
    typeof value === 'number' ? String(value).replace('.', ',') : value
  return /[;"\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

/**
 * Cost analysis of the Comunicação module (ADR 0050). Money is visible to
 * OWNER/ADMIN only. Meta amounts are **estimates** (template category x the
 * workspace price table at send time); Z-API has no per-message price, so
 * its cost is the connection's flat monthly fee spread over the volume.
 */
export const WhatsAppCostService = {
  /**
   * Called by `WhatsAppSend` after the provider accepted the message. Never
   * throws and never fails the send: a failure is only logged.
   */
  async record(input: {
    connection: Pick<
      WhatsAppConnection,
      'id' | 'workspaceId' | 'provider' | 'module'
    >
    kind: 'TEMPLATE' | 'SERVICE'
    to: string
    context?: WhatsAppCostContext
    now?: Date
  }): Promise<void> {
    const { connection } = input
    try {
      // The ServiceDesk line is another product: not part of this analysis.
      if (connection.module !== 'COMMUNICATION') return
      const now = input.now ?? new Date()
      const context = input.context ?? {}
      const paid = connection.provider === 'META' && input.kind === 'TEMPLATE'
      const category = paid
        ? normalizeTemplateCategory(context.templateCategory)
        : ('SERVICE' as const)
      const country = countryFromWaId(input.to)

      let unitPrice = 0
      let currency = DEFAULT_CURRENCY
      if (paid) {
        const stored = await WhatsAppCostRepository.listPrices(
          connection.workspaceId,
        )
        const rows =
          stored.ok && stored.value.length > 0
            ? toPriceRows(stored.value)
            : referenceRows()
        const price = resolveUnitPrice(rows, category, country, now, {
          lite: context.viaMarketingLite === true,
        })
        unitPrice = price.unitPrice
        currency = price.currency
      }
      const estimatedCost = multiplyMoney(unitPrice, 1)

      const saved = await WhatsAppCostRepository.createEntry({
        workspaceId: connection.workspaceId,
        connectionId: connection.id,
        provider: connection.provider,
        occurredAt: now,
        category,
        kind: paid ? 'TEMPLATE' : 'SERVICE',
        source: (context.source ?? 'OTHER') as WhatsAppCostSource,
        country,
        currency,
        broadcastId: context.broadcastId ?? null,
        aiCampaignId: context.aiCampaignId ?? null,
        conversationId: context.conversationId ?? null,
        userId: context.userId ?? null,
        quantity: 1,
        unitPrice,
        estimatedCost,
        viaMarketingLite: paid && context.viaMarketingLite === true,
      })
      if (!saved.ok) {
        logger.warn(
          'whatsapp.cost.record_failed',
          logFields(
            {
              component: 'WhatsAppCostService',
              workspaceId: connection.workspaceId,
            },
            { reason: saved.error.code },
          ),
        )
        return
      }
      if (estimatedCost > 0) {
        await WhatsAppCostService.evaluateBudget(connection.workspaceId, now)
      }
    } catch (error) {
      logger.warn(
        'whatsapp.cost.record_failed',
        logFields(
          {
            component: 'WhatsAppCostService',
            workspaceId: connection.workspaceId,
          },
          { reason: error instanceof Error ? error.message : String(error) },
        ),
      )
    }
  },

  /**
   * Month-to-date spend (estimated Meta charges + the connections' monthly
   * fees) against `monthlyCostBudget`. Warns admins once at 80% and once at
   * 100% per month (the notification `dedupeKey` makes it idempotent) and
   * never blocks anything. Returns the level that was evaluated.
   */
  async evaluateBudget(
    workspaceId: string,
    now = new Date(),
  ): Promise<80 | 100 | null> {
    try {
      const settings =
        await WhatsAppSettingsRepository.findByWorkspace(workspaceId)
      if (!settings.ok || settings.value?.monthlyCostBudget == null) return null
      const budget = Number(settings.value.monthlyCostBudget)

      const period = whatsappUsagePeriod(now)
      const { start, endExclusive } = monthBounds(period)
      const spent = await monthSpend(workspaceId, start, endExclusive)
      if (!spent.ok) return null
      const level = budgetLevel(spent.value.total, budget)
      if (level === null) return null

      const admins = await whatsAppAdminIds(workspaceId)
      const reached = level === 100
      await notifyWhatsAppUsers({
        workspaceId,
        kind: reached
          ? 'WHATSAPP_COST_BUDGET_REACHED'
          : 'WHATSAPP_COST_BUDGET_WARNING',
        userIds: admins,
        title: reached
          ? 'Orçamento de custo do WhatsApp atingido'
          : 'Custo do WhatsApp em 80% do orçamento',
        body: `${BRL.format(spent.value.total)} de ${BRL.format(budget)} estimados neste mês. Os envios continuam normalmente.`,
        path: '/zap/reports?aba=custos',
        dedupeKey: `whatsapp-cost-budget:${workspaceId}:${period}:${level}`,
        meta: { level, period },
      })
      return level
    } catch (error) {
      logger.warn(
        'whatsapp.cost.budget_failed',
        logFields(
          { component: 'WhatsAppCostService', workspaceId },
          { reason: error instanceof Error ? error.message : String(error) },
        ),
      )
      return null
    }
  },

  /** Price table. Seeds the labeled reference rows the first time. */
  async listPrices(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppPriceDTO[]>> {
    const access = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!access.ok) return access

    const existing = await WhatsAppCostRepository.listPrices(workspaceId)
    if (!existing.ok) return existing
    if (existing.value.length === 0) {
      const seeded = await WhatsAppCostRepository.seedPrices(
        BILLABLE_CATEGORIES.map((category: BillableCategory) => ({
          workspaceId,
          category,
          country: DEFAULT_COUNTRY,
          currency: DEFAULT_CURRENCY,
          unitPrice: REFERENCE_PRICES[category],
          validFrom: REFERENCE_VALID_FROM,
          reference: true,
        })),
      )
      if (!seeded.ok) return seeded
      const reread = await WhatsAppCostRepository.listPrices(workspaceId)
      if (!reread.ok) return reread
      return ok(reread.value.map(toPriceDTO))
    }
    return ok(existing.value.map(toPriceDTO))
  },

  /** Adds (or corrects) a price valid from a date; older sends keep theirs. */
  async createPrice(
    actorId: string,
    workspaceId: string,
    dto: CreateWhatsAppPriceDTO,
  ): Promise<Result<WhatsAppPriceDTO>> {
    const access = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!access.ok) return access

    const saved = await WhatsAppCostRepository.upsertPrice({
      workspaceId,
      category: dto.category,
      country: dto.country,
      currency: DEFAULT_CURRENCY,
      unitPrice: dto.unitPrice,
      liteUnitPrice: dto.liteUnitPrice ?? null,
      validFrom: dto.validFrom ? new Date(dto.validFrom) : new Date(),
      reference: false,
      createdById: actorId,
    })
    if (!saved.ok) return saved

    auditMutation({
      entity: 'whatsapp_cost_price',
      action: 'create',
      actorId,
      targetId: saved.value.id,
      meta: {
        workspaceId,
        category: dto.category,
        country: dto.country,
        unitPrice: dto.unitPrice,
        liteUnitPrice: dto.liteUnitPrice ?? null,
      },
    })
    return ok(toPriceDTO(saved.value))
  },

  async deletePrice(
    actorId: string,
    workspaceId: string,
    priceId: string,
  ): Promise<Result<void>> {
    const access = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!access.ok) return access

    const removed = await WhatsAppCostRepository.deletePrice(
      workspaceId,
      priceId,
    )
    if (!removed.ok) return removed
    if (!removed.value) return err(whatsappPriceNotFound())

    auditMutation({
      entity: 'whatsapp_cost_price',
      action: 'delete',
      actorId,
      targetId: priceId,
      meta: { workspaceId },
    })
    return ok(undefined)
  },

  async getSettings(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppCostSettingsDTO>> {
    const access = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!access.ok) return access
    return loadSettings(workspaceId)
  },

  async updateSettings(
    actorId: string,
    workspaceId: string,
    dto: UpdateWhatsAppCostSettingsDTO,
  ): Promise<Result<WhatsAppCostSettingsDTO>> {
    const access = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!access.ok) return access

    for (const fee of dto.connectionFees ?? []) {
      const saved = await WhatsAppCostRepository.setConnectionFee(
        workspaceId,
        fee.connectionId,
        fee.monthlyFee,
      )
      if (!saved.ok) return saved
      if (!saved.value) return err(notFound('Conexão'))
    }
    if (dto.monthlyCostBudget !== undefined) {
      const saved = await WhatsAppSettingsRepository.upsert(workspaceId, {
        monthlyCostBudget: dto.monthlyCostBudget,
      })
      if (!saved.ok) return saved
    }

    auditMutation({
      entity: 'whatsapp_cost_settings',
      action: 'update',
      actorId,
      targetId: workspaceId,
      meta: {
        workspaceId,
        monthlyCostBudget: dto.monthlyCostBudget,
        connectionFees: dto.connectionFees?.length ?? 0,
      },
    })

    // A new budget (or fee) may already be crossed this month.
    await WhatsAppCostService.evaluateBudget(workspaceId)
    return loadSettings(workspaceId)
  },

  async report(
    actorId: string,
    workspaceId: string,
    query: WhatsAppCostQueryDTO,
    now = new Date(),
  ): Promise<Result<WhatsAppCostReportDTO>> {
    const access = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!access.ok) return access
    return buildReport(workspaceId, query, now)
  },

  /** CSV (`;` separated, pt-BR decimals) with the same sections as the screen. */
  async exportCsv(
    actorId: string,
    workspaceId: string,
    query: WhatsAppCostQueryDTO,
    now = new Date(),
  ): Promise<Result<string>> {
    const access = await assertModulePrivileged(
      actorId,
      workspaceId,
      'COMMUNICATION',
    )
    if (!access.ok) return access
    const report = await buildReport(workspaceId, query, now)
    if (!report.ok) return report
    return ok(toCsv(report.value))
  },
}

async function loadSettings(
  workspaceId: string,
): Promise<Result<WhatsAppCostSettingsDTO>> {
  const [settings, connections] = await Promise.all([
    WhatsAppSettingsRepository.findByWorkspace(workspaceId),
    WhatsAppCostRepository.listConnections(workspaceId),
  ])
  if (!settings.ok) return settings
  if (!connections.ok) return connections
  return ok({
    monthlyCostBudget:
      settings.value?.monthlyCostBudget == null
        ? null
        : Number(settings.value.monthlyCostBudget),
    connections: connections.value.map((connection) => ({
      id: connection.id,
      label: connection.label,
      provider: connection.provider,
      monthlyFee: connection.monthlyFee,
    })),
  })
}

/** Variable cost to date plus the full monthly fees of the month. */
async function monthSpend(
  workspaceId: string,
  start: Date,
  endExclusive: Date,
): Promise<Result<{ variable: number; fees: number; total: number }>> {
  const [variable, connections] = await Promise.all([
    WhatsAppCostRepository.sumCost({ workspaceId, start, endExclusive }),
    WhatsAppCostRepository.listConnections(workspaceId),
  ])
  if (!variable.ok) return variable
  if (!connections.ok) return connections
  const fees = connections.value.reduce(
    (sum, connection) => sum + (connection.monthlyFee ?? 0),
    0,
  )
  return ok({ variable: variable.value, fees, total: variable.value + fees })
}

async function buildReport(
  workspaceId: string,
  query: WhatsAppCostQueryDTO,
  now: Date,
): Promise<Result<WhatsAppCostReportDTO>> {
  const { start, endExclusive } = rangeBounds(query.from, query.to)
  const filter: CostRangeFilter = {
    workspaceId,
    start,
    endExclusive,
    connectionId: query.connectionId,
  }
  const period = whatsappUsagePeriod(now)
  const month = monthBounds(period)

  const [
    totals,
    trend,
    byConnectionRows,
    byCategoryRows,
    byBroadcastRows,
    byCampaignRows,
    byAgentRows,
    bySourceRows,
    conversationRows,
    connections,
    settings,
    monthly,
  ] = await Promise.all([
    WhatsAppCostRepository.totals(filter),
    WhatsAppCostRepository.trend(filter),
    WhatsAppCostRepository.groupBy(filter, 'connectionId'),
    WhatsAppCostRepository.groupBy(filter, 'category'),
    WhatsAppCostRepository.groupBy(filter, 'broadcastId'),
    WhatsAppCostRepository.groupBy(filter, 'aiCampaignId'),
    WhatsAppCostRepository.groupBy(filter, 'userId'),
    WhatsAppCostRepository.groupBy(filter, 'source'),
    WhatsAppCostRepository.conversationCounts(filter),
    WhatsAppCostRepository.listConnections(workspaceId),
    WhatsAppSettingsRepository.findByWorkspace(workspaceId),
    monthSpend(workspaceId, month.start, month.endExclusive),
  ])
  if (!totals.ok) return totals
  if (!trend.ok) return trend
  if (!byConnectionRows.ok) return byConnectionRows
  if (!byCategoryRows.ok) return byCategoryRows
  if (!byBroadcastRows.ok) return byBroadcastRows
  if (!byCampaignRows.ok) return byCampaignRows
  if (!byAgentRows.ok) return byAgentRows
  if (!bySourceRows.ok) return bySourceRows
  if (!conversationRows.ok) return conversationRows
  if (!connections.ok) return connections
  if (!settings.ok) return settings
  if (!monthly.ok) return monthly

  const broadcastIds = byBroadcastRows.value.flatMap((r) =>
    r.key ? [r.key] : [],
  )
  const campaignIds = byCampaignRows.value.flatMap((r) =>
    r.key ? [r.key] : [],
  )
  const userIds = byAgentRows.value.flatMap((r) => (r.key ? [r.key] : []))
  const [broadcastNames, campaignNames, userNames] = await Promise.all([
    WhatsAppCostRepository.broadcastNames(workspaceId, broadcastIds),
    WhatsAppCostRepository.aiCampaignNames(workspaceId, campaignIds),
    WhatsAppCostRepository.userNames(userIds),
  ])
  if (!broadcastNames.ok) return broadcastNames
  if (!campaignNames.ok) return campaignNames
  if (!userNames.ok) return userNames

  // Connections: every Comunicação line (or the filtered one), with volume.
  const volume = new Map(byConnectionRows.value.map((r) => [r.key, r]))
  const conversations = new Map(
    conversationRows.value.map((r) => [r.connectionId, r]),
  )
  const feeFrom = new Date(`${query.from}T00:00:00Z`)
  const feeTo = new Date(`${query.to}T00:00:00Z`)
  const connectionRows: WhatsAppCostConnectionRowDTO[] = connections.value
    .filter((c) => !query.connectionId || c.id === query.connectionId)
    .map((connection) => {
      const row = volume.get(connection.id)
      const messages = row?.messages ?? 0
      const variableCost = row?.cost ?? 0
      const fee = proratedFee(connection.monthlyFee ?? 0, feeFrom, feeTo)
      const totalCost = variableCost + fee
      const convs = conversations.get(connection.id)?.conversations ?? 0
      return {
        connectionId: connection.id,
        label: connection.label,
        provider: connection.provider,
        messages,
        conversations: convs,
        variableCost: roundCents(variableCost),
        fee: roundCents(fee),
        totalCost: roundCents(totalCost),
        costPerMessage: roundCents(safeRatio(totalCost, messages)),
        costPerConversation: roundCents(safeRatio(totalCost, convs)),
      }
    })

  const providers = (['META', 'ZAPI'] as const).map(
    (provider): WhatsAppCostProviderRowDTO => {
      const rows = connectionRows.filter((r) => r.provider === provider)
      const sum = (pick: (r: WhatsAppCostConnectionRowDTO) => number) =>
        rows.reduce((acc, r) => acc + pick(r), 0)
      const messages = sum((r) => r.messages)
      const convs = sum((r) => r.conversations)
      const variableCost = sum((r) => r.variableCost)
      const fee = sum((r) => r.fee)
      const totalCost = variableCost + fee
      return {
        provider,
        connections: rows.length,
        messages,
        conversations: convs,
        variableCost: roundCents(variableCost),
        fee: roundCents(fee),
        totalCost: roundCents(totalCost),
        costPerMessage: roundCents(safeRatio(totalCost, messages)),
        costPerConversation: roundCents(safeRatio(totalCost, convs)),
      }
    },
  )

  const feesTotal = connectionRows.reduce((acc, r) => acc + r.fee, 0)
  const variableTotal = totals.value.cost
  const totalCost = variableTotal + feesTotal
  const conversationTotal = conversationRows.value.reduce(
    (acc, r) => acc + r.conversations,
    0,
  )
  const resolvedTotal = conversationRows.value.reduce(
    (acc, r) => acc + r.resolved,
    0,
  )

  // Projection and budget are month-to-date, whatever the filter says.
  const daysInMonth = daysInPeriod(period)
  const daysElapsed = Number(saoPauloDay(now).slice(8, 10))
  const monthCost =
    projectMonthCost({
      costToDate: monthly.value.variable,
      daysElapsed,
      daysInMonth,
    }) + monthly.value.fees
  const budget =
    settings.value?.monthlyCostBudget == null
      ? null
      : Number(settings.value.monthlyCostBudget)

  return ok({
    workspaceId,
    currency: DEFAULT_CURRENCY,
    from: query.from,
    to: query.to,
    connectionId: query.connectionId ?? null,
    totals: {
      messages: totals.value.messages,
      templateMessages: totals.value.templateMessages,
      serviceMessages: totals.value.messages - totals.value.templateMessages,
      variableCost: roundCents(variableTotal),
      fees: roundCents(feesTotal),
      totalCost: roundCents(totalCost),
      conversations: conversationTotal,
      resolvedConversations: resolvedTotal,
      costPerConversation: roundCents(safeRatio(totalCost, conversationTotal)),
      costPerResolvedConversation: roundCents(
        safeRatio(totalCost, resolvedTotal),
      ),
    },
    trend: trend.value.map((p) => ({ ...p, cost: roundCents(p.cost) })),
    byConnection: connectionRows,
    byProvider: providers,
    byCategory: breakdown(byCategoryRows.value, (k) => CATEGORY_LABEL[k] ?? k),
    byBroadcast: breakdown(
      byBroadcastRows.value,
      (k) => broadcastNames.value.get(k) ?? 'Transmissão removida',
    ),
    byAiCampaign: breakdown(
      byCampaignRows.value,
      (k) => campaignNames.value.get(k) ?? 'Campanha removida',
    ),
    byAgent: breakdown(
      byAgentRows.value,
      (k) => userNames.value.get(k) ?? 'Usuário removido',
    ),
    bySource: breakdown(bySourceRows.value, (k) => SOURCE_LABEL[k] ?? k),
    projection: {
      period,
      monthCost: roundCents(monthCost),
      variableToDate: roundCents(monthly.value.variable),
      fees: roundCents(monthly.value.fees),
      daysElapsed,
      daysInMonth,
    },
    budget: {
      monthlyCostBudget: budget,
      spent: roundCents(monthly.value.total),
      percent:
        budget && budget > 0
          ? Math.floor((monthly.value.total / budget) * 100)
          : null,
      level: budgetLevel(monthly.value.total, budget),
    },
  })
}

function toCsv(report: WhatsAppCostReportDTO): string {
  const lines: (string | number)[][] = [
    ['Seção', 'Item', 'Mensagens', 'Custo (R$)', 'Observação'],
    [
      'Total',
      `${report.from} a ${report.to}`,
      report.totals.messages,
      report.totals.totalCost,
      `Meta estimado ${report.totals.variableCost}; mensalidades ${report.totals.fees}`,
    ],
  ]
  for (const row of report.byConnection) {
    lines.push([
      'Conexão',
      `${row.label} (${row.provider === 'META' ? 'Meta' : 'Z-API'})`,
      row.messages,
      row.totalCost,
      `Por mensagem ${row.costPerMessage}; por conversa ${row.costPerConversation}`,
    ])
  }
  const sections: [string, WhatsAppCostBreakdownRowDTO[]][] = [
    ['Categoria', report.byCategory],
    ['Origem', report.bySource],
    ['Transmissão', report.byBroadcast],
    ['Campanha de IA', report.byAiCampaign],
    ['Atendente', report.byAgent],
  ]
  for (const [name, rows] of sections) {
    for (const row of rows) {
      lines.push([name, row.label, row.messages, row.cost, ''])
    }
  }
  for (const point of report.trend) {
    lines.push(['Dia', point.date, point.messages, point.cost, ''])
  }
  lines.push([
    'Estimativa',
    'Valores estimados com a tabela de preços do workspace; confira a fatura da Meta',
    '',
    '',
    '',
  ])
  return `﻿${lines.map((line) => line.map(csvCell).join(';')).join('\r\n')}\r\n`
}
