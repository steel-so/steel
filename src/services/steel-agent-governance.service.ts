import type { Role, SteelAgentPolicy } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logFields } from '@/lib/axiom/log-fields'
import { logger } from '@/lib/axiom/logger'
import { forbidden } from '@/src/errors'
import { findTool } from '@/src/lib/ai/tools/registry'
import type { AnySteelAiTool } from '@/src/lib/ai/tools/types'
import { toCsv } from '@/src/lib/crm-export'
import { err, ok, type Result } from '@/src/lib/result'
import {
  costPerApplied,
  decisionRates,
  EMPTY_DECISIONS,
  governanceSince,
  safeCsvCell,
} from '@/src/lib/steel-agents/governance'
import { isMcpToolName } from '@/src/lib/steel-agents/mcp-tools'
import { effectiveToolMode } from '@/src/lib/steel-agents/tool-mode'
import {
  toKillSwitchDTO,
  toSteelAgentPolicyDTO,
} from '@/src/mappers/steel-agent-governance.mapper'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import {
  SteelAgentRepository,
  type SteelAgentWithRelations,
} from '@/src/repositories/steel-agent.repository'
import {
  type AgentDecisionAggregate,
  type AgentImpactAggregate,
  type AgentRunAggregate,
  SteelAgentGovernanceMetricsRepository,
  SteelAgentPolicyRepository,
} from '@/src/repositories/steel-agent-governance.repository'
import { UserRepository } from '@/src/repositories/user.repository'
import type {
  KillSteelAgentsDTO,
  UpdateSteelAgentPolicyDTO,
} from '@/src/schemas/steel-agent-governance.schema'
import type {
  SteelAgentPolicyDTO,
  SteelAgentRiskFlagDTO,
  SteelGovernanceAgentDTO,
  SteelGovernanceDTO,
  SteelGovernanceToolDTO,
  SteelKillResultDTO,
} from '@/types/steel-governance'
import { assertMember, assertPrivileged } from './authz'
import { canManageSteelAgents } from './steel-agent.service'
import { loadMcpAgentTools } from './steel-mcp-tools'

/**
 * Governance of the Steel Agents (A6): inventory with the human owner,
 * permissions, approval/rejection rate and cost vs impact; the emergency
 * switch that pauses every agent of the workspace; the creators / AUTO
 * policy (A8); and a CSV for the LGPD record of processing. Reading needs
 * `steel-agents` EDIT (managers); the switch and the policy are
 * OWNER/ADMIN only.
 */

const MODULE_PERSONAL_DATA = new Set(['CRM', 'COMMUNICATION', 'SERVICE_DESK'])
const KILL_NOTE = 'Agentes pausados por emergência pelo administrador.'

async function assertManager(actorId: string, workspaceId: string) {
  const membership = await assertMember(actorId, workspaceId, {
    resource: 'steel-agents',
    action: 'VIEW',
  })
  if (!membership.ok) return membership
  if (!canManageSteelAgents(membership.value)) return err(forbidden())
  return membership
}

function toolMeta(
  name: string,
  mcp: Map<string, AnySteelAiTool>,
): Pick<SteelGovernanceToolDTO, 'label' | 'kind' | 'module' | 'external'> {
  const tool = findTool(name) ?? mcp.get(name)
  if (!tool) {
    return {
      label: name,
      kind: 'UNKNOWN',
      module: null,
      external: isMcpToolName(name),
    }
  }
  return {
    label: tool.label,
    kind: tool.kind,
    module: tool.module,
    external: isMcpToolName(name),
  }
}

interface Context {
  agents: SteelAgentWithRelations[]
  members: Map<string, { name: string; email: string; role: Role | null }>
  mcp: Map<string, AnySteelAiTool>
  runs: Map<string, AgentRunAggregate>
  decisions: Map<string, AgentDecisionAggregate>
  impact: Map<string, AgentImpactAggregate>
  policy: SteelAgentPolicy | null
}

function buildAgent(agent: SteelAgentWithRelations, ctx: Context) {
  const tools: SteelGovernanceToolDTO[] = agent.tools.map((t) => {
    const meta = toolMeta(t.toolName, ctx.mcp)
    return {
      toolName: t.toolName,
      ...meta,
      mode: effectiveToolMode(
        meta.kind === 'UNKNOWN' ? undefined : meta.kind,
        t.mode,
      ),
    }
  })
  const owner = agent.owner
  const ownerRole = owner ? (ctx.members.get(owner.id)?.role ?? null) : null
  const modules = [
    ...new Set(tools.flatMap((t) => (t.module ? [t.module] : []))),
  ]
  const runs = ctx.runs.get(agent.id)
  const decision = ctx.decisions.get(agent.id) ?? EMPTY_DECISIONS
  const rates = decisionRates(decision)
  const applied = ctx.impact.get(agent.id)?.applied ?? 0
  const cost = runs?.costUsd ?? 0

  const delegates = (agent.delegates ?? []).flatMap((d) => {
    const target = ctx.agents.find((a) => a.id === d.targetAgentId)
    return target ? [{ id: target.id, name: target.name }] : []
  })
  const risks: SteelAgentRiskFlagDTO[] = []
  if (!owner || !ownerRole) risks.push('NO_OWNER')
  if (tools.some((t) => t.mode === 'AUTO' && t.kind !== 'READ')) {
    risks.push('AUTO_WRITES')
  }
  if (tools.some((t) => t.external)) risks.push('CONTACTS_THIRD_PARTIES')
  if (delegates.length > 0) risks.push('DELEGATES')

  const dto: SteelGovernanceAgentDTO = {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    enabled: agent.enabled,
    triggerType: agent.triggerType,
    owner: owner
      ? {
          id: owner.id,
          name: owner.name,
          email: owner.email,
          role: ownerRole,
        }
      : null,
    createdByName: agent.createdById
      ? (ctx.members.get(agent.createdById)?.name ?? null)
      : null,
    tools,
    delegates,
    modules,
    risks,
    metrics: {
      runs: runs?.runs ?? 0,
      succeeded: runs?.succeeded ?? 0,
      failed: runs?.failed ?? 0,
      skipped: runs?.skipped ?? 0,
      costUsd: cost,
      delegatedCostUsd: runs?.delegatedCostUsd ?? 0,
      applied,
      approvals: {
        approved: rates.approved,
        rejected: decision.rejected,
        expired: decision.expired,
        pending: decision.pending,
      },
      approvalRate: rates.approvalRate,
      rejectionRate: rates.rejectionRate,
      costPerApplied: costPerApplied(cost, applied),
      lastRunAt: runs?.lastRunAt?.toISOString() ?? null,
    },
  }
  return dto
}

async function loadContext(
  workspaceId: string,
  since: Date,
): Promise<Result<Context>> {
  const [agents, members, mcp, runs, decisions, impact, policy] =
    await Promise.all([
      SteelAgentRepository.listByWorkspace(workspaceId),
      MembershipRepository.listWithUserByWorkspace(workspaceId),
      loadMcpAgentTools(workspaceId),
      SteelAgentGovernanceMetricsRepository.runs(workspaceId, since),
      SteelAgentGovernanceMetricsRepository.decisions(workspaceId, since),
      SteelAgentGovernanceMetricsRepository.impact(workspaceId, since),
      SteelAgentPolicyRepository.find(workspaceId),
    ])
  if (!agents.ok) return agents
  if (!members.ok) return members
  if (!mcp.ok) return mcp
  if (!runs.ok) return runs
  if (!decisions.ok) return decisions
  if (!impact.ok) return impact
  if (!policy.ok) return policy
  return ok({
    agents: agents.value,
    members: new Map(
      members.value.map((m) => [
        m.userId,
        { name: m.user.name, email: m.user.email, role: m.role },
      ]),
    ),
    mcp: new Map(mcp.value.map((t) => [t.name, t])),
    runs: new Map(runs.value.map((r) => [r.agentId, r])),
    decisions: new Map(decisions.value.map((d) => [d.agentId, d])),
    impact: new Map(impact.value.map((i) => [i.agentId, i])),
    policy: policy.value,
  })
}

async function killerName(policy: SteelAgentPolicy | null) {
  if (!policy?.killedById) return null
  const user = await UserRepository.findById(policy.killedById)
  return user.ok ? user.value.name : null
}

export const SteelAgentGovernanceService = {
  async overview(
    actorId: string,
    workspaceId: string,
    days: number,
    now: Date = new Date(),
  ): Promise<Result<SteelGovernanceDTO>> {
    const access = await assertManager(actorId, workspaceId)
    if (!access.ok) return access
    const since = governanceSince(days, now)
    const loaded = await loadContext(workspaceId, since)
    if (!loaded.ok) return loaded
    const ctx = loaded.value
    const agents = ctx.agents.map((agent) => buildAgent(agent, ctx))

    const approved = agents.reduce(
      (n, a) => n + a.metrics.approvals.approved,
      0,
    )
    const rejected = agents.reduce(
      (n, a) => n + a.metrics.approvals.rejected,
      0,
    )
    return ok({
      periodDays: days,
      since: since.toISOString(),
      killSwitch: toKillSwitchDTO(ctx.policy, await killerName(ctx.policy)),
      policy: toSteelAgentPolicyDTO(ctx.policy),
      totals: {
        agents: agents.length,
        active: agents.filter((a) => a.enabled).length,
        withoutOwner: agents.filter((a) => a.risks.includes('NO_OWNER')).length,
        runs: agents.reduce((n, a) => n + a.metrics.runs, 0),
        costUsd: agents.reduce((n, a) => n + a.metrics.costUsd, 0),
        applied: agents.reduce((n, a) => n + a.metrics.applied, 0),
        approvalRate:
          approved + rejected === 0 ? null : approved / (approved + rejected),
      },
      agents,
    })
  },

  /**
   * Emergency stop (OWNER/ADMIN): no agent runs until someone resumes.
   * Queued runs and pending approvals are canceled so nothing executes
   * after the fact. Idempotent.
   */
  async kill(
    actorId: string,
    workspaceId: string,
    dto: KillSteelAgentsDTO,
    now: Date = new Date(),
  ): Promise<Result<SteelKillResultDTO>> {
    const access = await assertPrivileged(actorId, workspaceId)
    if (!access.ok) return access
    const policy = await SteelAgentPolicyRepository.kill(
      workspaceId,
      actorId,
      dto.reason?.trim() || null,
      now,
    )
    if (!policy.ok) return policy
    const canceled = await SteelAgentPolicyRepository.cancelInFlight(
      workspaceId,
      now,
      KILL_NOTE,
    )
    if (!canceled.ok) return canceled
    const user = await UserRepository.findById(actorId)
    auditMutation({
      entity: 'steel_agent_governance',
      action: 'suspend',
      actorId,
      targetId: workspaceId,
      meta: {
        workspaceId,
        canceledRuns: canceled.value.runs,
        canceledActions: canceled.value.actions,
        hasReason: Boolean(dto.reason),
      },
    })
    logger.warn(
      'steel_agents.kill_switch_on',
      logFields(
        { component: 'SteelAgentGovernanceService', workspaceId },
        { actorId, ...canceled.value },
      ),
    )
    return ok({
      killSwitch: toKillSwitchDTO(
        policy.value,
        user.ok ? user.value.name : null,
      ),
      canceledRuns: canceled.value.runs,
      canceledActions: canceled.value.actions,
    })
  },

  async resume(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<SteelGovernanceDTO['killSwitch']>> {
    const access = await assertPrivileged(actorId, workspaceId)
    if (!access.ok) return access
    const resumed = await SteelAgentPolicyRepository.resume(
      workspaceId,
      actorId,
    )
    if (!resumed.ok) return resumed
    auditMutation({
      entity: 'steel_agent_governance',
      action: 'reactivate',
      actorId,
      targetId: workspaceId,
      meta: { workspaceId, wasActive: resumed.value !== null },
    })
    return ok(toKillSwitchDTO(null, null))
  },

  async updatePolicy(
    actorId: string,
    workspaceId: string,
    dto: UpdateSteelAgentPolicyDTO,
  ): Promise<Result<SteelAgentPolicyDTO>> {
    const access = await assertPrivileged(actorId, workspaceId)
    if (!access.ok) return access
    const saved = await SteelAgentPolicyRepository.saveRules(
      workspaceId,
      actorId,
      {
        restrictCreators: dto.restrictCreators,
        creatorRoles: [
          ...new Set(
            dto.creatorRoles.filter((r) => r !== 'OWNER' && r !== 'ADMIN'),
          ),
        ],
        restrictAuto: dto.restrictAuto,
        autoRules: {
          ADMIN: rule(dto.autoRules.ADMIN),
          MEMBER: rule(dto.autoRules.MEMBER),
          VIEWER: rule(dto.autoRules.VIEWER),
        },
      },
    )
    if (!saved.ok) return saved
    auditMutation({
      entity: 'steel_agent_policy',
      action: 'update',
      actorId,
      targetId: workspaceId,
      meta: {
        workspaceId,
        restrictCreators: dto.restrictCreators,
        creatorRoles: dto.creatorRoles,
        restrictAuto: dto.restrictAuto,
        autoModes: {
          ADMIN: dto.autoRules.ADMIN.mode,
          MEMBER: dto.autoRules.MEMBER.mode,
          VIEWER: dto.autoRules.VIEWER.mode,
        },
      },
    })
    return ok(toSteelAgentPolicyDTO(saved.value))
  },

  /** CSV of the inventory for the LGPD record of processing activities. */
  async exportCsv(
    actorId: string,
    workspaceId: string,
    days: number,
    now: Date = new Date(),
  ): Promise<Result<{ filename: string; csv: string }>> {
    const overview = await SteelAgentGovernanceService.overview(
      actorId,
      workspaceId,
      days,
      now,
    )
    if (!overview.ok) return overview
    const columns = [
      'Agente',
      'Situação',
      'Responsável',
      'E-mail do responsável',
      'Perfil do responsável',
      'Criado por',
      'Gatilho',
      'Módulos acessados',
      'Trata dados pessoais',
      'Contata terceiros ou sistemas externos',
      'Ferramentas',
      'Escritas automáticas',
      'Delega a',
      'Execuções',
      'Falhas',
      'Ações aprovadas',
      'Ações rejeitadas',
      'Taxa de aprovação (%)',
      'Taxa de rejeição (%)',
      'Escritas aplicadas',
      'Custo (US$)',
      'Custo por escrita aplicada (US$)',
      'Última execução',
    ]
    const pct = (value: number | null) =>
      value === null ? '' : (value * 100).toFixed(1)
    const rows = overview.value.agents.map((a) => ({
      Agente: safeCsvCell(a.name),
      Situação: a.enabled ? 'Ativo' : 'Pausado',
      Responsável: safeCsvCell(a.owner?.name ?? 'Sem responsável'),
      'E-mail do responsável': safeCsvCell(a.owner?.email ?? ''),
      'Perfil do responsável': a.owner?.role ?? 'Não é mais membro',
      'Criado por': safeCsvCell(a.createdByName ?? ''),
      Gatilho: a.triggerType,
      'Módulos acessados': a.modules.join(' | '),
      'Trata dados pessoais': a.modules.some((m) =>
        MODULE_PERSONAL_DATA.has(m),
      ),
      'Contata terceiros ou sistemas externos': a.risks.includes(
        'CONTACTS_THIRD_PARTIES',
      ),
      Ferramentas: a.tools.map((t) => `${t.toolName}:${t.mode}`).join(' | '),
      'Escritas automáticas': a.tools
        .filter((t) => t.mode === 'AUTO' && t.kind !== 'READ')
        .map((t) => t.toolName)
        .join(' | '),
      'Delega a': safeCsvCell(a.delegates.map((d) => d.name).join(' | ')),
      Execuções: a.metrics.runs,
      Falhas: a.metrics.failed,
      'Ações aprovadas': a.metrics.approvals.approved,
      'Ações rejeitadas': a.metrics.approvals.rejected,
      'Taxa de aprovação (%)': pct(a.metrics.approvalRate),
      'Taxa de rejeição (%)': pct(a.metrics.rejectionRate),
      'Escritas aplicadas': a.metrics.applied,
      'Custo (US$)': a.metrics.costUsd.toFixed(4),
      'Custo por escrita aplicada (US$)':
        a.metrics.costPerApplied === null
          ? ''
          : a.metrics.costPerApplied.toFixed(4),
      'Última execução': a.metrics.lastRunAt ?? '',
    }))
    auditMutation({
      entity: 'steel_agent_governance',
      action: 'download',
      actorId,
      targetId: workspaceId,
      meta: { workspaceId, agents: rows.length, days },
    })
    const stamp = now.toISOString().slice(0, 10)
    return ok({
      filename: `governanca-agentes-${stamp}.csv`,
      csv: toCsv(columns, rows),
    })
  },
}

function rule(r: { mode: 'ALL' | 'NONE' | 'LIST'; tools: string[] }) {
  return { mode: r.mode, tools: r.mode === 'LIST' ? [...new Set(r.tools)] : [] }
}
