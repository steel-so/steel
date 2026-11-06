import type { Role } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { whatsappAgentReportDisabled } from '@/src/errors'
import { recordAdminAction } from '@/src/lib/admin-audit'
import { err, ok, type Result } from '@/src/lib/result'
import {
  AGENT_REPORT_TIME_ZONE,
  agentReportCsvFileName,
  agentReportToCsv,
  buildAgentReport,
  resolveAgentReportPeriod,
} from '@/src/lib/whatsapp/agent-report'
import { toWhatsAppAgentReportSettingsDTO } from '@/src/mappers/whatsapp-agent-report.mapper'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import {
  type AgentReportRestriction,
  WhatsAppAgentReportRepository,
} from '@/src/repositories/whatsapp-agent-report.repository'
import { WorkspaceRepository } from '@/src/repositories/workspace.repository'
import type {
  UpdateWhatsAppAgentReportSettingsDTO,
  WhatsAppAgentReportQuery,
} from '@/src/schemas/whatsapp-agent-report.schema'
import type {
  WhatsAppAgentReportDTO,
  WhatsAppAgentReportSettingsDTO,
  WhatsAppAgentReportVisibility,
} from '@/types/whatsapp-agent-report'
import { assertModuleMember, assertPlatformAdmin } from './authz'
import { resolveConversationScope } from './whatsapp-conversation-scope.service'

/**
 * Agent performance report of the Comunicação module (ADR 0062). The
 * platform admin turns it on per workspace; workspace members then read the
 * "tabulação" metrics of the agents they may see: OWNER/ADMIN every agent, a
 * team leader the agents of the teams they lead (plus themselves), anybody
 * else only themselves. With the report off every read answers 404.
 */

interface Visibility {
  kind: WhatsAppAgentReportVisibility
  restriction?: AgentReportRestriction
}

async function isReportEnabled(workspaceId: string): Promise<Result<boolean>> {
  const settings = await WhatsAppAgentReportRepository.getSettings(workspaceId)
  if (!settings.ok) return settings
  return ok(settings.value?.enabled ?? false)
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

async function resolveVisibility(
  actorId: string,
  workspaceId: string,
  membership: { role: Role; isPrivileged: boolean },
): Promise<Result<Visibility>> {
  if (membership.isPrivileged) return ok({ kind: 'ALL' })
  const scope = await resolveConversationScope(
    actorId,
    workspaceId,
    membership.role,
  )
  if (!scope.ok) return scope
  if (scope.value.mode === 'ALL') return ok({ kind: 'ALL' })
  if (scope.value.leadsTeamIds.length > 0) {
    return ok({
      kind: 'TEAMS',
      restriction: {
        agentIds: unique([...scope.value.ledTeamMemberIds, actorId]),
        unassignedTeamIds: scope.value.leadsTeamIds,
      },
    })
  }
  return ok({
    kind: 'SELF',
    restriction: { agentIds: [actorId], unassignedTeamIds: [] },
  })
}

export const WhatsAppAgentReportService = {
  /** Whether the workspace has the report on (the zap reports page asks). */
  async isEnabled(workspaceId: string): Promise<boolean> {
    const enabled = await isReportEnabled(workspaceId)
    return enabled.ok && enabled.value
  },

  /**
   * Report of the period. Metrics: closed conversations (`closedAt` in the
   * period, by the assignee at closing time), success/failure of the
   * tabulated ones, closed without tabulation, mean `createdAt -> closedAt`
   * (a reopened conversation counts its whole life) and conversations still
   * open now.
   */
  async report(
    actorId: string,
    workspaceId: string,
    query: WhatsAppAgentReportQuery,
    now: Date = new Date(),
  ): Promise<Result<WhatsAppAgentReportDTO>> {
    const membership = await assertModuleMember(
      actorId,
      workspaceId,
      'COMMUNICATION',
      { resource: 'conversations', action: 'VIEW' },
    )
    if (!membership.ok) return membership

    const enabled = await isReportEnabled(workspaceId)
    if (!enabled.ok) return enabled
    if (!enabled.value) return err(whatsappAgentReportDisabled())

    const period = resolveAgentReportPeriod(query, now)
    if (!period.ok) return period

    const visibility = await resolveVisibility(
      actorId,
      workspaceId,
      membership.value,
    )
    if (!visibility.ok) return visibility

    const filter = {
      workspaceId,
      teamId: query.teamId,
      connectionId: query.connectionId,
      restriction: visibility.value.restriction,
    }
    const range = {
      ...filter,
      start: period.value.start,
      endExclusive: period.value.endExclusive,
    }
    const [members, closed, open, statuses] = await Promise.all([
      MembershipRepository.listWithUserByWorkspace(workspaceId),
      WhatsAppAgentReportRepository.closedByAgent(range),
      WhatsAppAgentReportRepository.openByAgent(filter),
      WhatsAppAgentReportRepository.statusesByAgent(range),
    ])
    if (!members.ok) return members
    if (!closed.ok) return closed
    if (!open.ok) return open
    if (!statuses.ok) return statuses

    const body = buildAgentReport({
      closed: closed.value,
      open: open.value,
      statuses: statuses.value,
      agentNames: new Map(
        members.value.map((member) => [member.userId, member.user.name]),
      ),
    })
    return ok({
      fromDay: period.value.fromDay,
      toDay: period.value.toDay,
      timeZone: AGENT_REPORT_TIME_ZONE,
      teamId: query.teamId ?? null,
      connectionId: query.connectionId ?? null,
      visibility: visibility.value.kind,
      ...body,
    })
  },

  /** The same report as a `;`-separated CSV (audited: it leaves the app). */
  async reportCsv(
    actorId: string,
    workspaceId: string,
    query: WhatsAppAgentReportQuery,
    now: Date = new Date(),
  ): Promise<Result<{ csv: string; fileName: string }>> {
    const report = await WhatsAppAgentReportService.report(
      actorId,
      workspaceId,
      query,
      now,
    )
    if (!report.ok) return report
    auditMutation({
      entity: 'whatsapp_agent_report',
      action: 'export',
      actorId,
      targetId: workspaceId,
      meta: {
        workspaceId,
        fromDay: report.value.fromDay,
        toDay: report.value.toDay,
        visibility: report.value.visibility,
      },
    })
    return ok({
      csv: agentReportToCsv(report.value),
      fileName: agentReportCsvFileName(report.value),
    })
  },

  /** Admin panel › workspace: is the report on? */
  async adminGetSettings(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<WhatsAppAgentReportSettingsDTO>> {
    const admin = await assertPlatformAdmin(actorId)
    if (!admin.ok) return admin
    const workspace = await WorkspaceRepository.findById(workspaceId)
    if (!workspace.ok) return workspace
    const settings =
      await WhatsAppAgentReportRepository.getSettings(workspaceId)
    if (!settings.ok) return settings
    return ok(toWhatsAppAgentReportSettingsDTO(settings.value))
  },

  async adminUpdateSettings(
    actorId: string,
    workspaceId: string,
    input: UpdateWhatsAppAgentReportSettingsDTO,
  ): Promise<Result<WhatsAppAgentReportSettingsDTO>> {
    const admin = await assertPlatformAdmin(actorId)
    if (!admin.ok) return admin
    const workspace = await WorkspaceRepository.findById(workspaceId)
    if (!workspace.ok) return workspace

    const saved = await WhatsAppAgentReportRepository.upsertSettings(
      workspaceId,
      { enabled: input.enabled, updatedById: admin.value.userId },
    )
    if (!saved.ok) return saved

    await recordAdminAction({
      actor: admin.value,
      action: 'whatsapp_agent_report.settings',
      audit: { entity: 'whatsapp_agent_report_settings', action: 'update' },
      targetType: 'workspace',
      targetId: workspaceId,
      targetLabel: workspace.value.slug,
      meta: { enabled: saved.value.enabled },
    })
    return ok(toWhatsAppAgentReportSettingsDTO(saved.value))
  },
}
