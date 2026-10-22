import { logger } from '@/lib/axiom/logger'
import { forbidden, validationError } from '@/src/errors'
import { toCsv } from '@/src/lib/crm-export'
import { err, ok, type Result } from '@/src/lib/result'
import type { WhatsAppBusinessHours } from '@/src/lib/whatsapp/business-hours'
import { WHATSAPP_BUSINESS_HOURS_TIME_ZONE } from '@/src/lib/whatsapp/business-hours'
import {
  canSeeConversation,
  type WhatsAppConversationScope,
} from '@/src/lib/whatsapp/conversation-scope'
import { summarizeSlaCycles } from '@/src/lib/whatsapp/sla-report'
import {
  businessMillisBetween,
  computeSlaDeadlines,
} from '@/src/lib/whatsapp/sla-time'
import { toWhatsAppSlaOpenCycleDTO } from '@/src/mappers/whatsapp-sla.mapper'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppSlaCycleRepository } from '@/src/repositories/whatsapp-sla-cycle.repository'
import { WhatsAppSlaPolicyRepository } from '@/src/repositories/whatsapp-sla-policy.repository'
import { WhatsAppTeamRepository } from '@/src/repositories/whatsapp-team.repository'
import type { WhatsAppSlaReportQuery } from '@/src/schemas/whatsapp-sla.schema'
import type {
  WhatsAppSlaOpenCycleDTO,
  WhatsAppSlaReportDTO,
} from '@/types/whatsapp-sla'
import { assertModuleMember } from './authz'
import { resolveConversationScope } from './whatsapp-conversation-scope.service'
import { WhatsAppSettingsService } from './whatsapp-settings.service'

/** The conversation fields the SLA bookkeeping looks at. */
export interface WhatsAppSlaConversationRef {
  id: string
  workspaceId: string
  teamId: string | null
  assignedUserId: string | null
}

async function loadHours(
  workspaceId: string,
): Promise<Result<WhatsAppBusinessHours>> {
  const settings = await WhatsAppSettingsService.getEffective(workspaceId)
  if (!settings.ok) return settings
  return ok({
    enabled: settings.value.businessHoursEnabled,
    start: settings.value.businessHoursStart,
    end: settings.value.businessHoursEnd,
    days: settings.value.businessHoursDays,
  })
}

/**
 * SLA bookkeeping must never fail the webhook, the send or the close that
 * triggered it: errors are logged and swallowed.
 */
async function guarded(
  operation: string,
  context: Record<string, unknown>,
  run: () => Promise<Result<unknown>>,
): Promise<void> {
  try {
    const result = await run()
    if (!result.ok) {
      logger.warn('whatsapp.sla.bookkeeping_failed', {
        component: 'WhatsAppSlaService',
        operation,
        reason: result.error.code,
        ...context,
      })
    }
  } catch (error) {
    logger.error('whatsapp.sla.bookkeeping_threw', {
      component: 'WhatsAppSlaService',
      operation,
      error: error instanceof Error ? error.message : String(error),
      ...context,
    })
  }
}

const DAY_MS = 24 * 60 * 60 * 1000
/** America/Sao_Paulo has no daylight saving time since 2019. */
const SAO_PAULO_OFFSET = '-03:00'
const DEFAULT_REPORT_DAYS = 30
const MAX_REPORT_DAYS = 366

function startOfDay(value: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00${SAO_PAULO_OFFSET}`)
    : new Date(value)
}

/** Report window: `to` is inclusive for a plain date, default last 30 days. */
export function resolveSlaReportPeriod(
  query: Pick<WhatsAppSlaReportQuery, 'from' | 'to'>,
  now: Date,
): Result<{ from: Date; to: Date }> {
  const to = query.to
    ? /^\d{4}-\d{2}-\d{2}$/.test(query.to)
      ? new Date(startOfDay(query.to).getTime() + DAY_MS)
      : new Date(query.to)
    : new Date(now.getTime() + 1)
  const from = query.from
    ? startOfDay(query.from)
    : new Date(to.getTime() - DEFAULT_REPORT_DAYS * DAY_MS)
  if (from >= to) {
    return err(validationError('A data inicial deve ser anterior à final'))
  }
  if (to.getTime() - from.getTime() > MAX_REPORT_DAYS * DAY_MS) {
    return err(validationError('O período do relatório é de no máximo 1 ano'))
  }
  return ok({ from, to })
}

export const WhatsAppSlaService = {
  /**
   * A contact message arrived. Opens an SLA cycle when the conversation has
   * none (new or just reopened) and a policy applies. Safe to call on every
   * inbound message.
   */
  async onInbound(
    conversation: WhatsAppSlaConversationRef,
    now: Date = new Date(),
  ): Promise<void> {
    await guarded('inbound', { conversationId: conversation.id }, async () => {
      const open = await WhatsAppSlaCycleRepository.findOpenByConversation(
        conversation.id,
      )
      if (!open.ok) return open
      if (open.value) return ok(undefined)

      const policy = await WhatsAppSlaPolicyRepository.resolveForTeam(
        conversation.workspaceId,
        conversation.teamId,
      )
      if (!policy.ok) return policy
      if (!policy.value?.enabled) return ok(undefined)
      const rule = policy.value

      const hours = await loadHours(conversation.workspaceId)
      if (!hours.ok) return hours
      // Without business hours configured the clock is plain wall time.
      const businessHoursOnly = rule.businessHoursOnly && hours.value.enabled

      const deadlines = computeSlaDeadlines(
        hours.value,
        {
          firstResponseMinutes: rule.firstResponseMinutes,
          resolutionMinutes: rule.resolutionMinutes,
          warnAtPercent: rule.warnAtPercent,
          businessHoursOnly,
        },
        now,
      )
      if (!deadlines) {
        logger.warn('whatsapp.sla.never_opens', {
          component: 'WhatsAppSlaService',
          workspaceId: conversation.workspaceId,
        })
        return ok(undefined)
      }

      const created = await WhatsAppSlaCycleRepository.create({
        workspaceId: conversation.workspaceId,
        conversationId: conversation.id,
        policyId: rule.id,
        teamId: conversation.teamId,
        agentUserId: conversation.assignedUserId,
        businessHoursOnly,
        firstResponseMinutes: rule.firstResponseMinutes,
        resolutionMinutes: rule.resolutionMinutes,
        countAiAsResponse: rule.countAiAsResponse,
        startedAt: now,
        firstResponseDueAt: deadlines.firstResponseDueAt,
        firstResponseWarnAt: deadlines.firstResponseWarnAt,
        resolutionDueAt: deadlines.resolutionDueAt,
        resolutionWarnAt: deadlines.resolutionWarnAt,
      })
      if (!created.ok) return created
      if (!created.value) return ok(undefined) // lost a benign race

      return WhatsAppConversationRepository.update(conversation.id, {
        firstInboundAt: now,
        firstResponseAt: null,
      })
    })
  },

  /**
   * An outbound message was recorded. The first one by a person (or by the
   * AI when the policy counts it) closes the first-response clock.
   */
  async onOutbound(
    input: {
      workspaceId: string
      conversationId: string
      /** Sender agent; null for the AI. */
      senderUserId: string | null
      byAi: boolean
    },
    now: Date = new Date(),
  ): Promise<void> {
    await guarded(
      'outbound',
      { conversationId: input.conversationId },
      async () => {
        const open = await WhatsAppSlaCycleRepository.findOpenByConversation(
          input.conversationId,
        )
        if (!open.ok) return open
        const cycle = open.value
        if (!cycle || cycle.firstResponseAt) return ok(undefined)
        if (input.byAi && !cycle.countAiAsResponse) return ok(undefined)

        let elapsedMs = now.getTime() - cycle.startedAt.getTime()
        if (cycle.businessHoursOnly) {
          const hours = await loadHours(input.workspaceId)
          if (!hours.ok) return hours
          elapsedMs = businessMillisBetween(hours.value, cycle.startedAt, now)
        }

        const recorded = await WhatsAppSlaCycleRepository.recordFirstResponse(
          cycle.id,
          {
            at: now,
            seconds: Math.max(0, Math.round(elapsedMs / 1000)),
            agentUserId: input.senderUserId,
          },
        )
        if (!recorded.ok) return recorded
        if (!recorded.value) return ok(undefined)

        return WhatsAppConversationRepository.update(input.conversationId, {
          firstResponseAt: now,
        })
      },
    )
  },

  /** The conversation was closed: the open cycle ends. */
  async onClosed(
    conversation: Pick<WhatsAppSlaConversationRef, 'id' | 'assignedUserId'>,
    now: Date = new Date(),
  ): Promise<void> {
    await guarded('closed', { conversationId: conversation.id }, () =>
      WhatsAppSlaCycleRepository.resolveOpen(conversation.id, {
        at: now,
        agentUserId: conversation.assignedUserId,
      }),
    )
  },

  /**
   * Open cycles the viewer may see (conversation visibility rule), with the
   * state at `now`. `state` keeps only the at-risk / breached ones.
   */
  async listOpen(
    actorId: string,
    workspaceId: string,
    filter: { state?: 'AT_RISK' | 'BREACHED' } = {},
    now: Date = new Date(),
  ): Promise<Result<WhatsAppSlaOpenCycleDTO[]>> {
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'conversations', action: 'VIEW' },
    )
    if (!membership.ok) return membership
    const scope: Result<WhatsAppConversationScope> =
      await resolveConversationScope(
        actorId,
        workspaceId,
        membership.value.role,
      )
    if (!scope.ok) return scope

    const rows =
      await WhatsAppSlaCycleRepository.listOpenByWorkspace(workspaceId)
    if (!rows.ok) return rows

    const visible = rows.value
      .filter((row) => canSeeConversation(scope.value, row.conversation))
      .map((row) => toWhatsAppSlaOpenCycleDTO(row, now))
    return ok(
      filter.state
        ? visible.filter((cycle) =>
            filter.state === 'BREACHED'
              ? cycle.state === 'BREACHED'
              : cycle.state !== 'OK',
          )
        : visible,
    )
  },

  /** SLA report of the period (workspace admins and team leaders only). */
  async report(
    actorId: string,
    workspaceId: string,
    query: WhatsAppSlaReportQuery,
    now: Date = new Date(),
  ): Promise<Result<WhatsAppSlaReportDTO>> {
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'conversations', action: 'VIEW' },
    )
    if (!membership.ok) return membership
    const scope = await resolveConversationScope(
      actorId,
      workspaceId,
      membership.value.role,
    )
    if (!scope.ok) return scope
    // Agents see the report of their own work only through the teams they
    // lead; a plain agent has no team scope and gets a forbidden answer.
    const leadsTeams = scope.value.leadsTeamIds.length > 0
    if (scope.value.mode === 'SCOPED' && !leadsTeams) {
      return err(
        forbidden(
          'Somente administradores e líderes de equipe veem o relatório de SLA',
        ),
      )
    }

    const period = resolveSlaReportPeriod(query, now)
    if (!period.ok) return period

    const [members, teams, rows] = await Promise.all([
      MembershipRepository.listWithUserByWorkspace(workspaceId),
      WhatsAppTeamRepository.listByWorkspace(workspaceId),
      WhatsAppSlaCycleRepository.listForReport({
        workspaceId,
        from: period.value.from,
        to: period.value.to,
        teamId: query.teamId,
      }),
    ])
    if (!members.ok) return members
    if (!teams.ok) return teams
    if (!rows.ok) return rows

    // A team leader sees only the teams they lead.
    const allowed =
      scope.value.mode === 'ALL'
        ? rows.value
        : rows.value.filter(
            (row) =>
              row.teamId && scope.value.leadsTeamIds.includes(row.teamId),
          )

    const summary = summarizeSlaCycles({
      rows: allowed,
      now,
      agentLabels: new Map(
        members.value.map((member) => [member.userId, member.user.name]),
      ),
      teamLabels: new Map(teams.value.map((team) => [team.id, team.name])),
    })

    return ok({
      from: period.value.from.toISOString(),
      to: period.value.to.toISOString(),
      timeZone: WHATSAPP_BUSINESS_HOURS_TIME_ZONE,
      teamId: query.teamId ?? null,
      ...summary,
    })
  },

  /** CSV of the report: summary lines, then agents and teams. */
  async reportCsv(
    actorId: string,
    workspaceId: string,
    query: WhatsAppSlaReportQuery,
    now: Date = new Date(),
  ): Promise<Result<string>> {
    const report = await WhatsAppSlaService.report(
      actorId,
      workspaceId,
      query,
      now,
    )
    if (!report.ok) return report
    return ok(slaReportToCsv(report.value))
  },
}

export function slaReportToCsv(report: WhatsAppSlaReportDTO): string {
  const minutes = (value: number | null) =>
    value === null ? '' : (value / 60).toFixed(1).replace('.', ',')
  const pct = (value: number | null) =>
    value === null ? '' : String(value).replace('.', ',')
  const columns = [
    'Seção',
    'Nome',
    'Avaliados',
    'Dentro do prazo',
    'Dentro do prazo (%)',
    'Média (min)',
    'P90 (min)',
    'Estouros',
  ]
  const rows: Record<string, unknown>[] = [
    {
      Seção: 'Primeira resposta',
      Nome: 'Total',
      Avaliados: report.firstResponse.evaluated,
      'Dentro do prazo': report.firstResponse.withinTarget,
      'Dentro do prazo (%)': pct(report.firstResponse.withinPercent),
      'Média (min)': minutes(report.firstResponse.averageSeconds),
      'P90 (min)': minutes(report.firstResponse.p90Seconds),
      Estouros:
        report.firstResponse.evaluated - report.firstResponse.withinTarget,
    },
    {
      Seção: 'Resolução',
      Nome: 'Total',
      Avaliados: report.resolution.evaluated,
      'Dentro do prazo': report.resolution.withinTarget,
      'Dentro do prazo (%)': pct(report.resolution.withinPercent),
      Estouros: report.resolution.evaluated - report.resolution.withinTarget,
    },
    ...report.byAgent.map((row) => ({
      Seção: 'Atendente',
      Nome: row.label,
      Avaliados: row.cycles,
      Estouros: row.breaches,
    })),
    ...report.byTeam.map((row) => ({
      Seção: 'Equipe',
      Nome: row.label,
      Avaliados: row.cycles,
      Estouros: row.breaches,
    })),
  ]
  return toCsv(columns, rows)
}
