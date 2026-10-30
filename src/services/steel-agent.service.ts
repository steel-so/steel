import type {
  ModuleKind,
  Prisma,
  Role,
  SteelAgentPolicy,
  SteelAgentTriggerType,
  SteelAgentVersion,
} from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logFields } from '@/lib/axiom/log-fields'
import { logger } from '@/lib/axiom/logger'
import { forbidden } from '@/src/errors'
import {
  steelAgentAutoNotAllowed,
  steelAgentCreateForbidden,
  steelAgentDelegateInvalid,
  steelAgentDisabled,
  steelAgentInvalidOwner,
  steelAgentInvalidTool,
  steelAgentInvalidTrigger,
  steelAgentRunNotFound,
  steelAgentsPaused,
} from '@/src/errors/app-error'
import { STEEL_AI_TOOLS } from '@/src/lib/ai/tools'
import { findTool } from '@/src/lib/ai/tools/registry'
import type { AnySteelAiTool } from '@/src/lib/ai/tools/types'
import { can } from '@/src/lib/permissions'
import { err, ok, type Result } from '@/src/lib/result'
import {
  DELEGATE_TOOL_LABEL,
  DELEGATE_TOOL_NAME,
  MAX_DELEGATES_PER_AGENT,
} from '@/src/lib/steel-agents/delegation'
import { enqueueSteelAgentRun } from '@/src/lib/steel-agents/enqueue'
import { STEEL_AGENT_EVENTS } from '@/src/lib/steel-agents/events'
import {
  canRoleRunAuto,
  roleMayCreateAgents,
} from '@/src/lib/steel-agents/policy'
import {
  normalizeSteelAgentTrigger,
  steelAgentTriggerProblem,
} from '@/src/lib/steel-agents/schedule'
import { effectiveToolMode } from '@/src/lib/steel-agents/tool-mode'
import { versionContentChanged } from '@/src/lib/steel-agents/versions'
import {
  toSteelAgentDTO,
  toSteelAgentRunDetailDTO,
  toSteelAgentRunDTO,
  toSteelAgentVersionRefDTO,
} from '@/src/mappers/steel-agent.mapper'
import { WorkspaceAiSettingsRepository } from '@/src/repositories/ai-settings.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import {
  SteelAgentDelegateRepository,
  SteelAgentRepository,
  SteelAgentRunRepository,
  type SteelAgentToolInput,
} from '@/src/repositories/steel-agent.repository'
import { SteelAgentPolicyRepository } from '@/src/repositories/steel-agent-governance.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import type {
  CreateSteelAgentDTO,
  ListSteelAgentRunsQueryDTO,
  UpdateSteelAgentDTO,
} from '@/src/schemas/steel-agent.schema'
import type {
  SteelAgentCatalogDTO,
  SteelAgentDTO,
  SteelAgentRunDetailDTO,
  SteelAgentRunDTO,
  SteelAgentUpdateResultDTO,
} from '@/types/steel-agent'
import { assertMember, type MembershipContext } from './authz'
import { SteelAgentVersionService } from './steel-agent-version.service'
import { loadMcpAgentTools } from './steel-mcp-tools'

/**
 * Steel Agents CRUD, catalog, run history and "Executar agora". RBAC
 * resource `steel-agents`: admins manage (CREATE/EDIT/DELETE), members and
 * viewers only VIEW. Approvals live in `steel-agent-approval.service.ts`.
 */

const RESOURCE = 'steel-agents'

/** Lookups over the static registry plus the workspace's MCP tools. */
async function toolLookups(workspaceId: string) {
  const mcp = await loadMcpAgentTools(workspaceId)
  const dynamic = new Map<string, AnySteelAiTool>(
    (mcp.ok ? mcp.value : []).map((tool) => [tool.name, tool]),
  )
  const find = (name: string) => findTool(name) ?? dynamic.get(name)
  return {
    mcp: mcp.ok ? mcp.value : [],
    kindOf: (name: string) => find(name)?.kind,
    labelOf: (name: string) =>
      name === DELEGATE_TOOL_NAME
        ? DELEGATE_TOOL_LABEL
        : (find(name)?.label ?? null),
  }
}

export function canManageSteelAgents(membership: MembershipContext): boolean {
  return (
    membership.isPrivileged ||
    (membership.permissions !== null &&
      can(membership.permissions, RESOURCE, 'EDIT'))
  )
}

/** Creating agents: the policy (when restricted) or the RBAC matrix. */
export function canCreateSteelAgents(
  membership: MembershipContext,
  policy: SteelAgentPolicy | null,
): boolean {
  const byPolicy = roleMayCreateAgents(policy, membership.role)
  if (byPolicy !== null) return byPolicy
  return (
    membership.isPrivileged ||
    (membership.permissions !== null &&
      can(membership.permissions, RESOURCE, 'CREATE'))
  )
}

/**
 * Edit/delete: the RBAC matrix, or — with a creators policy — the creator
 * of the agent while their role is still allowed to create.
 */
function mayChangeAgent(
  membership: MembershipContext,
  policy: SteelAgentPolicy | null,
  action: 'EDIT' | 'DELETE',
  actorId: string,
  createdById: string | null,
): boolean {
  if (
    membership.isPrivileged ||
    (membership.permissions !== null &&
      can(membership.permissions, RESOURCE, action))
  ) {
    return true
  }
  return (
    policy?.restrictCreators === true &&
    createdById === actorId &&
    canCreateSteelAgents(membership, policy)
  )
}

async function enabledModules(
  workspaceId: string,
): Promise<Result<ModuleKind[]>> {
  const modules =
    await WorkspaceModuleAccessRepository.listByWorkspace(workspaceId)
  if (!modules.ok) return modules
  return ok(modules.value.filter((m) => m.enabled).map((m) => m.module))
}

/** Every tool must exist and belong to an enabled module (or the platform). */
async function validateTools(
  workspaceId: string,
  tools: { toolName: string; mode: 'AUTO' | 'APPROVAL' }[],
): Promise<Result<SteelAgentToolInput[]>> {
  if (tools.length === 0) return ok([])
  const modules = await enabledModules(workspaceId)
  if (!modules.ok) return modules
  const lookups = await toolLookups(workspaceId)
  const find = (name: string) =>
    findTool(name) ?? lookups.mcp.find((tool) => tool.name === name)
  const out: SteelAgentToolInput[] = []
  for (const input of tools) {
    const tool = find(input.toolName)
    if (!tool || (tool.module && !modules.value.includes(tool.module))) {
      return err(steelAgentInvalidTool(input.toolName))
    }
    out.push({
      toolName: tool.name,
      mode: effectiveToolMode(tool.kind, input.mode),
    })
  }
  return ok(out)
}

/**
 * A8: with the AUTO policy on, the role of whoever saves the agent has to
 * allow each tool that becomes automatic (tools already automatic before
 * the edit are left alone; the runner re-checks the owner's role anyway).
 */
function assertAutoAllowed(
  policy: SteelAgentPolicy | null,
  role: Role,
  tools: SteelAgentToolInput[],
  previouslyAuto: Set<string>,
): Result<true> {
  for (const tool of tools) {
    if (tool.mode !== 'AUTO' || previouslyAuto.has(tool.toolName)) continue
    const kind = findTool(tool.toolName)?.kind
    if (kind === 'READ') continue
    if (!canRoleRunAuto(policy, role, tool.toolName)) {
      return err(steelAgentAutoNotAllowed(tool.toolName))
    }
  }
  return ok(true)
}

/**
 * A7: delegates must be other agents of the workspace and must not close a
 * cycle in the delegation graph (the runner also guards each chain).
 */
async function validateDelegates(
  workspaceId: string,
  agentId: string | null,
  ids: string[],
): Promise<Result<string[]>> {
  const unique = [...new Set(ids)]
  if (unique.length > MAX_DELEGATES_PER_AGENT) {
    return err(
      steelAgentDelegateInvalid(
        `Um agente pode delegar a no máximo ${MAX_DELEGATES_PER_AGENT} agentes.`,
      ),
    )
  }
  if (agentId && unique.includes(agentId)) {
    return err(
      steelAgentDelegateInvalid('Um agente não pode delegar a si mesmo.'),
    )
  }
  const existing = await SteelAgentDelegateRepository.existingInWorkspace(
    workspaceId,
    unique,
  )
  if (!existing.ok) return existing
  if (existing.value.length !== unique.length) {
    return err(
      steelAgentDelegateInvalid(
        'Algum agente escolhido para delegação não existe neste workspace.',
      ),
    )
  }
  if (!agentId || unique.length === 0) return ok(unique)

  const edges = await SteelAgentDelegateRepository.edges(workspaceId)
  if (!edges.ok) return edges
  const next = new Map<string, string[]>()
  for (const edge of edges.value) {
    if (edge.agentId === agentId) continue
    next.set(edge.agentId, [
      ...(next.get(edge.agentId) ?? []),
      edge.targetAgentId,
    ])
  }
  // Can any new target already reach `agentId`?
  const seen = new Set<string>()
  const stack = [...unique]
  while (stack.length > 0) {
    const node = stack.pop() as string
    if (node === agentId) {
      return err(
        steelAgentDelegateInvalid(
          'Essa delegação criaria um ciclo entre agentes (A delega a B e B volta a A).',
        ),
      )
    }
    if (seen.has(node)) continue
    seen.add(node)
    stack.push(...(next.get(node) ?? []))
  }
  return ok(unique)
}

async function validateOwner(
  ownerId: string,
  workspaceId: string,
): Promise<Result<true>> {
  const membership = await MembershipRepository.findByUserAndWorkspace(
    ownerId,
    workspaceId,
  )
  if (!membership.ok) return membership
  if (!membership.value) return err(steelAgentInvalidOwner())
  return ok(true)
}

/** Creates a QUEUED MANUAL run (real or test) and enqueues it. */
async function startRun(
  actorId: string,
  workspaceId: string,
  agentId: string,
  test: boolean,
  /** A4: re-execute the trigger of this run as a test. */
  rerunOf?: string,
): Promise<Result<SteelAgentRunDTO>> {
  const membership = await assertMember(actorId, workspaceId, {
    resource: RESOURCE,
    action: 'VIEW',
  })
  if (!membership.ok) return membership
  const agent = await SteelAgentRepository.findById(agentId, workspaceId)
  if (!agent.ok) return agent
  if (
    agent.value.ownerId !== actorId &&
    !canManageSteelAgents(membership.value)
  ) {
    return err(forbidden())
  }
  if (!test && !agent.value.enabled) return err(steelAgentDisabled())
  if (!test) {
    const policy = await SteelAgentPolicyRepository.find(workspaceId)
    if (!policy.ok) return policy
    if (policy.value?.killedAt) return err(steelAgentsPaused())
  }

  let source: { triggerType: SteelAgentTriggerType; payload: unknown } | null =
    null
  if (rerunOf) {
    const original = await SteelAgentRunRepository.findDetail(
      rerunOf,
      workspaceId,
    )
    if (!original.ok) return original
    if (original.value.agentId !== agentId) return err(steelAgentRunNotFound())
    source = {
      triggerType: original.value.triggerType,
      payload: original.value.triggerPayload,
    }
  }

  const run = await SteelAgentRunRepository.create({
    workspaceId,
    agentId,
    triggerType: source?.triggerType ?? 'MANUAL',
    ...(source?.payload != null && {
      triggerPayload: source.payload as Prisma.InputJsonValue,
    }),
    startedById: actorId,
    ...(test && { isTest: true }),
    ...(rerunOf && { rerunOfId: rerunOf }),
  })
  if (!run.ok) return run
  const queued = await enqueueSteelAgentRun(run.value.id)
  if (!queued.ok) {
    await SteelAgentRunRepository.update(run.value.id, {
      status: 'FAILED',
      error: queued.error.message,
      finishedAt: new Date(),
    })
    return queued
  }

  auditMutation({
    entity: 'steel_agent_run',
    action: 'start',
    actorId,
    targetId: run.value.id,
    meta: {
      workspaceId,
      agentId,
      ...(test && { mode: 'TEST' }),
      ...(rerunOf && { rerunOfId: rerunOf }),
    },
  })
  logger.info(
    'steel_agents.run_requested',
    logFields(
      { component: 'SteelAgentService', workspaceId },
      { agentId, runId: run.value.id, test, rerunOf: rerunOf ?? null },
    ),
  )
  return ok(toSteelAgentRunDTO(run.value))
}

export const SteelAgentService = {
  async list(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<SteelAgentDTO[]>> {
    const membership = await assertMember(actorId, workspaceId, {
      resource: RESOURCE,
      action: 'VIEW',
    })
    if (!membership.ok) return membership
    const agents = await SteelAgentRepository.listByWorkspace(workspaceId)
    if (!agents.ok) return agents
    const { kindOf } = await toolLookups(workspaceId)
    return ok(agents.value.map((agent) => toSteelAgentDTO(agent, kindOf)))
  },

  async get(
    actorId: string,
    workspaceId: string,
    agentId: string,
  ): Promise<Result<SteelAgentDTO>> {
    const membership = await assertMember(actorId, workspaceId, {
      resource: RESOURCE,
      action: 'VIEW',
    })
    if (!membership.ok) return membership
    const agent = await SteelAgentRepository.findById(agentId, workspaceId)
    if (!agent.ok) return agent
    const { kindOf } = await toolLookups(workspaceId)
    return ok(toSteelAgentDTO(agent.value, kindOf))
  },

  /** Tools and events the editor may offer (enabled modules only). */
  async catalog(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<SteelAgentCatalogDTO>> {
    const membership = await assertMember(actorId, workspaceId, {
      resource: RESOURCE,
      action: 'VIEW',
    })
    if (!membership.ok) return membership
    const [modules, settings, policy, lookups] = await Promise.all([
      enabledModules(workspaceId),
      WorkspaceAiSettingsRepository.findByWorkspace(workspaceId),
      SteelAgentPolicyRepository.find(workspaceId),
      toolLookups(workspaceId),
    ])
    if (!modules.ok) return modules
    if (!settings.ok) return settings
    if (!policy.ok) return policy

    const inScope = (module: ModuleKind | null) =>
      module === null || modules.value.includes(module)
    return ok({
      tools: STEEL_AI_TOOLS.filter((tool) => inScope(tool.module))
        .map((tool) => ({
          name: tool.name,
          label: tool.label,
          description: tool.description,
          module: tool.module,
          kind: tool.kind,
        }))
        .concat(
          lookups.mcp.map((tool) => ({
            name: tool.name,
            label: tool.label,
            description: tool.description,
            module: null,
            kind: tool.kind,
            external: true,
          })),
        ),
      events: STEEL_AGENT_EVENTS.filter((event) => inScope(event.module)).map(
        (event) => ({ ...event }),
      ),
      agentModeEnabled: settings.value?.agentModeEnabled ?? true,
      canManage: canManageSteelAgents(membership.value),
      canCreate: canCreateSteelAgents(membership.value, policy.value),
      autoRestricted: policy.value?.restrictAuto ?? false,
      autoAllowedTools: (policy.value?.restrictAuto
        ? [...STEEL_AI_TOOLS, ...lookups.mcp]
            .filter((tool) =>
              canRoleRunAuto(policy.value, membership.value.role, tool.name),
            )
            .map((tool) => tool.name)
        : null) as string[] | null,
    })
  },

  async create(
    actorId: string,
    workspaceId: string,
    dto: CreateSteelAgentDTO,
  ): Promise<Result<SteelAgentDTO>> {
    const membership = await assertMember(actorId, workspaceId)
    if (!membership.ok) return membership
    const policy = await SteelAgentPolicyRepository.find(workspaceId)
    if (!policy.ok) return policy
    if (!canCreateSteelAgents(membership.value, policy.value)) {
      return err(
        policy.value?.restrictCreators
          ? steelAgentCreateForbidden()
          : forbidden(),
      )
    }

    const owner = await validateOwner(dto.ownerId, workspaceId)
    if (!owner.ok) return owner
    const tools = await validateTools(workspaceId, dto.tools)
    if (!tools.ok) return tools
    const auto = assertAutoAllowed(
      policy.value,
      membership.value.role,
      tools.value,
      new Set(),
    )
    if (!auto.ok) return auto
    const delegates = await validateDelegates(
      workspaceId,
      null,
      dto.delegateAgentIds,
    )
    if (!delegates.ok) return delegates

    if (dto.evalSetId) {
      const set = await SteelAgentVersionService.checkEvalSet(
        workspaceId,
        dto.evalSetId,
        { requireCases: false },
      )
      if (!set.ok) return set
    }

    const trigger = normalizeSteelAgentTrigger(dto)
    const created = await SteelAgentRepository.create({
      workspaceId,
      createdById: actorId,
      name: dto.name,
      description: dto.description ?? null,
      instructions: dto.instructions,
      triggerType: dto.triggerType,
      ...trigger,
      enabled: dto.enabled,
      ownerId: dto.ownerId,
      maxToolRounds: dto.maxToolRounds,
      monthlyRunCap: dto.monthlyRunCap ?? null,
      evalSetId: dto.evalSetId ?? null,
      evalMinPassRate: dto.evalMinPassRate,
      tools: tools.value,
      delegateIds: delegates.value,
    })
    if (!created.ok) return created

    // v1 = the agent as created; a failure here is retried on the first edit.
    const baseline = await SteelAgentVersionService.ensureBaseline(
      created.value,
      actorId,
    )
    if (!baseline.ok) {
      logger.warn(
        'steel_agents.baseline_version_failed',
        logFields(
          { component: 'SteelAgentService', workspaceId },
          { agentId: created.value.id, code: baseline.error.code },
        ),
      )
    }

    auditMutation({
      entity: 'steel_agent',
      action: 'create',
      actorId,
      targetId: created.value.id,
      meta: {
        workspaceId,
        ownerId: dto.ownerId,
        triggerType: dto.triggerType,
        tools: tools.value.map((t) => `${t.toolName}:${t.mode}`),
        ...(delegates.value.length > 0 && { delegates: delegates.value }),
      },
    })
    const { kindOf } = await toolLookups(workspaceId)
    return ok(toSteelAgentDTO(created.value, kindOf))
  },

  async update(
    actorId: string,
    workspaceId: string,
    agentId: string,
    dto: UpdateSteelAgentDTO,
  ): Promise<Result<SteelAgentUpdateResultDTO>> {
    const membership = await assertMember(actorId, workspaceId)
    if (!membership.ok) return membership
    const policy = await SteelAgentPolicyRepository.find(workspaceId)
    if (!policy.ok) return policy

    const current = await SteelAgentRepository.findById(agentId, workspaceId)
    if (!current.ok) return current
    if (
      !mayChangeAgent(
        membership.value,
        policy.value,
        'EDIT',
        actorId,
        current.value.createdById,
      )
    ) {
      return err(forbidden())
    }

    if (dto.ownerId && dto.ownerId !== current.value.ownerId) {
      const owner = await validateOwner(dto.ownerId, workspaceId)
      if (!owner.ok) return owner
    }
    let tools: SteelAgentToolInput[] | undefined
    if (dto.tools) {
      const validated = await validateTools(workspaceId, dto.tools)
      if (!validated.ok) return validated
      tools = validated.value
      const auto = assertAutoAllowed(
        policy.value,
        membership.value.role,
        tools,
        new Set(
          current.value.tools
            .filter((t) => t.mode === 'AUTO')
            .map((t) => t.toolName),
        ),
      )
      if (!auto.ok) return auto
    }
    let delegateIds: string[] | undefined
    if (dto.delegateAgentIds) {
      const validated = await validateDelegates(
        workspaceId,
        agentId,
        dto.delegateAgentIds,
      )
      if (!validated.ok) return validated
      delegateIds = validated.value
    }

    const merged = {
      triggerType: dto.triggerType ?? current.value.triggerType,
      cron: dto.cron !== undefined ? dto.cron : current.value.cron,
      timezone: dto.timezone ?? current.value.timezone,
      eventKey:
        dto.eventKey !== undefined ? dto.eventKey : current.value.eventKey,
    }
    const problem = steelAgentTriggerProblem(merged)
    if (problem) return err(steelAgentInvalidTrigger(problem))

    const evalSetId =
      dto.evalSetId !== undefined ? dto.evalSetId : current.value.evalSetId
    if (dto.evalSetId) {
      const set = await SteelAgentVersionService.checkEvalSet(
        workspaceId,
        dto.evalSetId,
        { requireCases: false },
      )
      if (!set.ok) return set
    }

    const simGateEnabled =
      dto.simGateEnabled !== undefined
        ? dto.simGateEnabled
        : current.value.simGateEnabled
    if (dto.simGateEnabled) {
      const gate = await SteelAgentVersionService.checkSimulationGate(agentId)
      if (!gate.ok) return gate
    }

    // Instructions, tools and the round cap are versioned: they reach the
    // agent through `SteelAgentVersionService` (gate eval, optional A/B).
    const {
      tools: _tools,
      delegateAgentIds: _delegates,
      changeNote,
      rolloutPercent,
      instructions,
      maxToolRounds,
      ...fields
    } = dto
    const currentContent = {
      instructions: current.value.instructions,
      maxToolRounds: current.value.maxToolRounds,
      tools: current.value.tools.map((t) => ({
        toolName: t.toolName,
        mode: t.mode,
      })),
    }
    const nextContent = {
      instructions: instructions ?? currentContent.instructions,
      maxToolRounds: maxToolRounds ?? currentContent.maxToolRounds,
      tools: tools ?? currentContent.tools,
    }
    let version: SteelAgentVersion | null = null
    if (versionContentChanged(currentContent, nextContent)) {
      const submitted = await SteelAgentVersionService.submit({
        actorId,
        agent: current.value,
        content: nextContent,
        changeNote: changeNote ?? null,
        rolloutPercent: rolloutPercent ?? null,
        evalSetId,
        simGateEnabled,
      })
      if (!submitted.ok) return submitted
      version = submitted.value
    }

    const updated = await SteelAgentRepository.update(
      agentId,
      {
        ...fields,
        ...(version === null && {
          ...(instructions !== undefined && { instructions }),
          ...(maxToolRounds !== undefined && { maxToolRounds }),
        }),
        ...normalizeSteelAgentTrigger(merged),
      },
      undefined,
      delegateIds,
    )
    if (!updated.ok) return updated

    auditMutation({
      entity: 'steel_agent',
      action: 'update',
      actorId,
      targetId: agentId,
      meta: {
        workspaceId,
        fields: Object.keys(dto),
        ...(tools && { tools: tools.map((t) => `${t.toolName}:${t.mode}`) }),
        ...(version && {
          versionId: version.id,
          versionNumber: version.number,
        }),
        ...(delegateIds && { delegates: delegateIds }),
      },
    })
    const { kindOf } = await toolLookups(workspaceId)
    return ok({
      ...toSteelAgentDTO(updated.value, kindOf),
      version: version ? toSteelAgentVersionRefDTO(version) : null,
    })
  },

  async delete(
    actorId: string,
    workspaceId: string,
    agentId: string,
  ): Promise<Result<SteelAgentDTO>> {
    const membership = await assertMember(actorId, workspaceId)
    if (!membership.ok) return membership
    const policy = await SteelAgentPolicyRepository.find(workspaceId)
    if (!policy.ok) return policy
    const current = await SteelAgentRepository.findById(agentId, workspaceId)
    if (!current.ok) return current
    if (
      !mayChangeAgent(
        membership.value,
        policy.value,
        'DELETE',
        actorId,
        current.value.createdById,
      )
    ) {
      return err(forbidden())
    }
    const deleted = await SteelAgentRepository.delete(agentId)
    if (!deleted.ok) return deleted
    auditMutation({
      entity: 'steel_agent',
      action: 'delete',
      actorId,
      targetId: agentId,
      meta: { workspaceId, name: current.value.name },
    })
    const { kindOf } = await toolLookups(workspaceId)
    return ok(toSteelAgentDTO(current.value, kindOf))
  },

  /** "Executar agora": the owner or a manager; paused agents refuse. */
  async runNow(
    actorId: string,
    workspaceId: string,
    agentId: string,
  ): Promise<Result<SteelAgentRunDTO>> {
    return startRun(actorId, workspaceId, agentId, false)
  },

  /**
   * "Testar agente": same gate as "Executar agora", but the run is a test —
   * reads run for real, every write is simulated (no approvals, nothing
   * sent), and it never touches the schedule (`lastRunAt`/`nextRunAt`) nor
   * the monthly cap. A paused agent may be tested (that is the point of
   * trying it before switching it on).
   */
  async testRun(
    actorId: string,
    workspaceId: string,
    agentId: string,
  ): Promise<Result<SteelAgentRunDTO>> {
    return startRun(actorId, workspaceId, agentId, true)
  },

  /**
   * "Reexecutar como teste" (A4): replays the trigger and input of a past
   * run as a test run — reads real, writes simulated — so the admin can see
   * whether an edited prompt or tool list would now decide differently.
   */
  async rerunAsTest(
    actorId: string,
    workspaceId: string,
    agentId: string,
    runId: string,
  ): Promise<Result<SteelAgentRunDTO>> {
    return startRun(actorId, workspaceId, agentId, true, runId)
  },

  async listRuns(
    actorId: string,
    workspaceId: string,
    agentId: string,
    query: ListSteelAgentRunsQueryDTO,
  ): Promise<Result<SteelAgentRunDTO[]>> {
    const membership = await assertMember(actorId, workspaceId, {
      resource: RESOURCE,
      action: 'VIEW',
    })
    if (!membership.ok) return membership
    const agent = await SteelAgentRepository.findById(agentId, workspaceId)
    if (!agent.ok) return agent
    const runs = await SteelAgentRunRepository.listByAgent(agentId, query)
    if (!runs.ok) return runs
    return ok(runs.value.map(toSteelAgentRunDTO))
  },

  async getRun(
    actorId: string,
    workspaceId: string,
    agentId: string,
    runId: string,
  ): Promise<Result<SteelAgentRunDetailDTO>> {
    const membership = await assertMember(actorId, workspaceId, {
      resource: RESOURCE,
      action: 'VIEW',
    })
    if (!membership.ok) return membership
    const run = await SteelAgentRunRepository.findDetail(runId, workspaceId)
    if (!run.ok) return run
    if (run.value.agentId !== agentId) return err(steelAgentRunNotFound())
    const { labelOf } = await toolLookups(workspaceId)
    return ok(
      toSteelAgentRunDetailDTO(run.value, {
        canApprove:
          run.value.agent.ownerId === actorId ||
          canManageSteelAgents(membership.value),
        labelOf,
      }),
    )
  },
}
