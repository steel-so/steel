import type { ModuleKind } from '@prisma/client'
import { logFields } from '@/lib/axiom/log-fields'
import { logger } from '@/lib/axiom/logger'
import { safeTimeZone } from '@/src/lib/ai/proactive/format'
import {
  agentEventFor,
  newEpisodes,
  planInsightReconcile,
} from '@/src/lib/ai/proactive/reconcile'
import {
  type AiInsightDraft,
  buildCrmInsights,
  buildSdInsights,
  buildZapInsights,
  type CrmForecastSignal,
  type CrmInsightViewer,
  PROACTIVE_RULES,
  type SdInsightViewer,
  staleDealsOf,
  type ZapConversationSignal,
  type ZapInsightViewer,
} from '@/src/lib/ai/proactive/rules'
import { ok, type Result } from '@/src/lib/result'
import {
  formatSdTicketCode,
  resolveSdTicketPrefixes,
} from '@/src/lib/servicedesk/ticket-code'
import { scopeFromSnapshot } from '@/src/lib/whatsapp/conversation-scope'
import { AiInsightRepository } from '@/src/repositories/ai-insight.repository'
import {
  AiProactiveSignalRepository,
  type ProactiveMemberRow,
  type ProactiveWorkspaceRow,
  type ZapConversationRow,
} from '@/src/repositories/ai-proactive-signal.repository'
import { CrmSalesMetricsRepository } from '@/src/repositories/crm-sales-metrics.repository'
import { SdTicketContextRepository } from '@/src/repositories/sd-ticket-context.repository'
import { AI_INSIGHT_MODULE_KINDS } from './ai-insight-access'
import { assertModuleMember } from './authz'
import { CrmSalesMetricsService } from './crm-sales-metrics.service'
import { SdAccess } from './sd-access'
import { dispatchSteelAgentEvent } from './steel-agent-dispatcher'
import { loadWhatsAppTeamSnapshot } from './whatsapp-conversation-scope.service'

/**
 * The `ai-proactive` insights tick (ADR 0040): for every active workspace
 * with Steel AI and the proactive AI on, reads each enabled module's
 * signals, decides who may see what (the modules' own rules), builds the
 * drafts (`src/lib/ai/proactive/rules.ts`) and reconciles them with the
 * rows already there. No LLM. Never throws: a failing module or workspace
 * is logged and counted, and its insights are left as they were.
 */

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
/** Resolved episodes are kept this long (history of the feed), then pruned. */
export const AI_INSIGHT_RESOLVED_RETENTION_DAYS = 30
const DEFAULT_TIME_ZONE = 'America/Sao_Paulo'

export interface AiInsightTickResult {
  workspaces: number
  evaluated: number
  disabled: number
  created: number
  refreshed: number
  reopened: number
  resolved: number
  events: number
  pruned: number
  errors: number
}

function emptyResult(): AiInsightTickResult {
  return {
    workspaces: 0,
    evaluated: 0,
    disabled: 0,
    created: 0,
    refreshed: 0,
    reopened: 0,
    resolved: 0,
    events: 0,
    pruned: 0,
    errors: 0,
  }
}

function logModuleFailure(
  workspaceId: string,
  module: ModuleKind,
  reason: string,
) {
  logger.warn(
    'ai.proactive.module_failed',
    logFields(
      { component: 'AiInsightGenerator', workspaceId },
      { module, reason },
    ),
  )
}

/* ------------------------------- ServiceDesk ------------------------------ */

async function sdDrafts(
  workspace: ProactiveWorkspaceRow,
  members: ProactiveMemberRow[],
  now: Date,
): Promise<Result<AiInsightDraft[]>> {
  const until = new Date(
    now.getTime() + PROACTIVE_RULES.sdForecastWindowHours * HOUR_MS,
  )
  const rows = await AiProactiveSignalRepository.sdBreachForecast(
    workspace.id,
    now,
    until,
  )
  if (!rows.ok) return rows
  if (rows.value.length === 0) return ok([])

  const [calendar, settings] = await Promise.all([
    SdTicketContextRepository.findDefaultCalendar(workspace.id),
    SdTicketContextRepository.ensureSettings(workspace.id),
  ])
  if (!calendar.ok) return calendar
  if (!settings.ok) return settings
  const prefixes = resolveSdTicketPrefixes(settings.value.ticketPrefixes)

  const viewers: SdInsightViewer[] = []
  for (const member of members) {
    const access = await SdAccess.resolve(member.userId, workspace.id, {
      resource: 'sd-tickets',
      action: 'VIEW',
    })
    // Requesters (no department) never get queue insights.
    if (!access.ok || !access.value.isAgent) continue
    viewers.push({
      userId: member.userId,
      isAdmin: access.value.isAdmin,
      leadDepartmentIds: access.value.leadDepartmentIds,
    })
  }

  return ok(
    buildSdInsights({
      slug: workspace.slug,
      timeZone: safeTimeZone(calendar.value?.timezone, DEFAULT_TIME_ZONE),
      now,
      viewers,
      signals: rows.value.map((row) => ({
        ticketId: row.ticketId,
        number: row.number,
        code: formatSdTicketCode(row.type, row.number, prefixes),
        title: row.title,
        departmentId: row.departmentId,
        departmentName: row.departmentName,
        assigneeId: row.assigneeId,
        breachEtaAt: row.breachEtaAt,
        score: row.score,
      })),
    }),
  )
}

/* ----------------------------------- CRM ---------------------------------- */

async function crmForecast(
  workspaceId: string,
  now: Date,
): Promise<CrmForecastSignal | null> {
  const metric = await CrmSalesMetricsService.compute(
    workspaceId,
    {
      kind: 'forecast',
      period: 'month',
      stalledDays: PROACTIVE_RULES.crmStaleDays,
    },
    now,
  )
  // A forecast failure only drops the gap insight (logged by the service).
  if (!metric.ok || metric.value.kind !== 'forecast') return null
  return {
    periodKey: metric.value.period.key,
    periodLabel: metric.value.period.label,
    targetAmount: metric.value.targetAmount,
    weightedAmount: metric.value.weightedAmount,
    wonAmount: metric.value.wonAmount,
  }
}

async function crmDrafts(
  workspace: ProactiveWorkspaceRow,
  members: ProactiveMemberRow[],
  now: Date,
): Promise<Result<AiInsightDraft[]>> {
  const open = await CrmSalesMetricsRepository.listOpen(workspace.id)
  if (!open.ok) return open
  const activity = await CrmSalesMetricsRepository.lastActivityByOpportunity(
    workspace.id,
    open.value.map((deal) => deal.id),
  )
  if (!activity.ok) return activity

  const deals = staleDealsOf(
    open.value.map((deal) => ({
      id: deal.id,
      name: deal.name,
      amount: deal.amount === null ? null : Number(deal.amount),
      stageId: deal.stage.id,
      stageName: deal.stage.name,
      ownerId: deal.owner?.id ?? null,
      updatedAt: deal.updatedAt,
    })),
    activity.value,
    now,
  )
  const forecast = await crmForecast(workspace.id, now)
  if (deals.length === 0 && !forecast?.targetAmount) return ok([])

  const viewers: CrmInsightViewer[] = []
  for (const member of members) {
    const access = await assertModuleMember(
      member.userId,
      workspace.id,
      'CRM',
      { resource: 'opportunities', action: 'VIEW' },
    )
    if (!access.ok) continue
    viewers.push({
      userId: member.userId,
      isPrivileged: access.value.isPrivileged,
    })
  }

  return ok(
    buildCrmInsights({ slug: workspace.slug, deals, forecast, viewers }),
  )
}

/* ------------------------------- Comunicação ------------------------------ */

function zapSignal(row: ZapConversationRow): ZapConversationSignal {
  return {
    id: row.id,
    contactName: row.contactName,
    assignedUserId: row.assignedUserId,
    teamId: row.teamId,
    since: row.lastMessageAt ?? row.createdAt,
    score: row.avgSentimentScore,
  }
}

async function zapDrafts(
  workspace: ProactiveWorkspaceRow,
  members: ProactiveMemberRow[],
  now: Date,
): Promise<Result<AiInsightDraft[]>> {
  const [waiting, rule] = await Promise.all([
    AiProactiveSignalRepository.zapWaiting(
      workspace.id,
      new Date(now.getTime() - PROACTIVE_RULES.zapWaitingMinutes * MINUTE_MS),
    ),
    AiProactiveSignalRepository.zapSentimentRule(workspace.id),
  ])
  if (!waiting.ok) return waiting
  if (!rule.ok) return rule

  let negative: ZapConversationRow[] = []
  if (rule.value.enabled) {
    const rows = await AiProactiveSignalRepository.zapNegative(
      workspace.id,
      rule.value.threshold,
      new Date(
        now.getTime() - PROACTIVE_RULES.zapSentimentWindowHours * HOUR_MS,
      ),
    )
    if (!rows.ok) return rows
    negative = rows.value
  }
  if (waiting.value.length === 0 && negative.length === 0) return ok([])

  const snapshot = await loadWhatsAppTeamSnapshot(workspace.id)
  if (!snapshot.ok) return snapshot

  const viewers: ZapInsightViewer[] = []
  for (const member of members) {
    const access = await assertModuleMember(
      member.userId,
      workspace.id,
      'COMMUNICATION',
      { resource: 'conversations', action: 'VIEW' },
    )
    if (!access.ok) continue
    viewers.push({
      userId: member.userId,
      scope: scopeFromSnapshot(
        member.userId,
        access.value.role,
        snapshot.value,
      ),
    })
  }

  return ok(
    buildZapInsights({
      slug: workspace.slug,
      now,
      waiting: waiting.value.map(zapSignal),
      negative: negative.map(zapSignal),
      threshold: rule.value.threshold,
      viewers,
    }),
  )
}

/* -------------------------------- Workspace ------------------------------- */

const BUILDERS: Record<
  (typeof AI_INSIGHT_MODULE_KINDS)[number],
  typeof sdDrafts
> = {
  SERVICE_DESK: sdDrafts,
  CRM: crmDrafts,
  COMMUNICATION: zapDrafts,
}

async function evaluateWorkspace(
  workspace: ProactiveWorkspaceRow,
  now: Date,
  result: AiInsightTickResult,
): Promise<void> {
  const members = await AiProactiveSignalRepository.listMembers(workspace.id)
  if (!members.ok) {
    result.errors += 1
    return
  }

  const drafts: AiInsightDraft[] = []
  // A module the workspace disabled counts as evaluated with nothing: its
  // insights resolve. A module that failed is left untouched.
  const evaluated: ModuleKind[] = []
  for (const module of AI_INSIGHT_MODULE_KINDS) {
    if (!workspace.modules.includes(module)) {
      evaluated.push(module)
      continue
    }
    const built = await BUILDERS[module](workspace, members.value, now)
    if (!built.ok) {
      result.errors += 1
      logModuleFailure(workspace.id, module, built.error.code)
      continue
    }
    drafts.push(...built.value)
    evaluated.push(module)
  }

  const existing = await AiInsightRepository.listForReconcile(workspace.id)
  if (!existing.ok) {
    result.errors += 1
    return
  }
  const plan = planInsightReconcile(existing.value, drafts, evaluated)
  const applied = await AiInsightRepository.applyPlan(workspace.id, plan, now)
  if (!applied.ok) {
    result.errors += 1
    return
  }
  result.evaluated += 1
  result.created += applied.value.created
  result.refreshed += applied.value.refreshed
  result.reopened += applied.value.reopened
  result.resolved += applied.value.resolved

  for (const draft of newEpisodes(plan)) {
    const event = agentEventFor(draft)
    if (!event) continue
    const dispatched = await dispatchSteelAgentEvent(workspace.id, event, {
      insightKind: draft.kind,
      severity: draft.severity,
      dedupeKey: draft.dedupeKey,
      title: draft.title,
      facts: draft.facts,
      href: draft.href,
    })
    result.events += dispatched
  }
}

export const AiInsightGeneratorService = {
  async runTick(now: Date = new Date()): Promise<AiInsightTickResult> {
    const result = emptyResult()

    const pruned = await AiInsightRepository.deleteResolvedBefore(
      new Date(now.getTime() - AI_INSIGHT_RESOLVED_RETENTION_DAYS * DAY_MS),
    )
    if (pruned.ok) result.pruned = pruned.value
    else result.errors += 1

    const workspaces = await AiProactiveSignalRepository.listWorkspaces()
    if (!workspaces.ok) {
      result.errors += 1
      logger.error('ai.proactive.workspaces_failed', {
        component: 'AiInsightGenerator',
        reason: workspaces.error.code,
      })
      return result
    }
    result.workspaces = workspaces.value.length

    for (const workspace of workspaces.value) {
      if (!workspace.aiEnabled || !workspace.proactiveEnabled) {
        result.disabled += 1
        const resolved = await AiInsightRepository.resolveAllActive(
          workspace.id,
          now,
        )
        if (resolved.ok) result.resolved += resolved.value
        else result.errors += 1
        continue
      }
      try {
        await evaluateWorkspace(workspace, now, result)
      } catch (error) {
        result.errors += 1
        logger.error(
          'ai.proactive.workspace_failed',
          logFields(
            {
              component: 'AiInsightGenerator',
              workspaceId: workspace.id,
              message: error instanceof Error ? error.message : String(error),
            },
            {},
          ),
        )
      }
    }

    logger.info('ai.proactive.insights_tick', { ...result })
    return result
  },
}
