import type { ModuleKind, Prisma, SteelAgentTriggerType } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import { logFields } from '@/lib/axiom/log-fields'
import { logger } from '@/lib/axiom/logger'
import { forbidden } from '@/src/errors'
import {
  steelAgentDisabled,
  steelAgentInvalidOwner,
  steelAgentInvalidTool,
  steelAgentInvalidTrigger,
  steelAgentRunNotFound,
} from '@/src/errors/app-error'
import { STEEL_AI_TOOLS } from '@/src/lib/ai/tools'
import { findTool } from '@/src/lib/ai/tools/registry'
import { can } from '@/src/lib/permissions'
import { err, ok, type Result } from '@/src/lib/result'
import { enqueueSteelAgentRun } from '@/src/lib/steel-agents/enqueue'
import { STEEL_AGENT_EVENTS } from '@/src/lib/steel-agents/events'
import {
  normalizeSteelAgentTrigger,
  steelAgentTriggerProblem,
} from '@/src/lib/steel-agents/schedule'
import { effectiveToolMode } from '@/src/lib/steel-agents/tool-mode'
import {
  toSteelAgentDTO,
  toSteelAgentRunDetailDTO,
  toSteelAgentRunDTO,
} from '@/src/mappers/steel-agent.mapper'
import { WorkspaceAiSettingsRepository } from '@/src/repositories/ai-settings.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import {
  SteelAgentRepository,
  SteelAgentRunRepository,
  type SteelAgentToolInput,
} from '@/src/repositories/steel-agent.repository'
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
} from '@/types/steel-agent'
import { assertMember, type MembershipContext } from './authz'

/**
 * Steel Agents CRUD, catalog, run history and "Executar agora". RBAC
 * resource `steel-agents`: admins manage (CREATE/EDIT/DELETE), members and
 * viewers only VIEW. Approvals live in `steel-agent-approval.service.ts`.
 */

const RESOURCE = 'steel-agents'

const kindOf = (name: string) => findTool(name)?.kind
const labelOf = (name: string) => findTool(name)?.label ?? null

export function canManageSteelAgents(membership: MembershipContext): boolean {
  return (
    membership.isPrivileged ||
    (membership.permissions !== null &&
      can(membership.permissions, RESOURCE, 'EDIT'))
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
  const out: SteelAgentToolInput[] = []
  for (const input of tools) {
    const tool = findTool(input.toolName)
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
    const [modules, settings] = await Promise.all([
      enabledModules(workspaceId),
      WorkspaceAiSettingsRepository.findByWorkspace(workspaceId),
    ])
    if (!modules.ok) return modules
    if (!settings.ok) return settings

    const inScope = (module: ModuleKind | null) =>
      module === null || modules.value.includes(module)
    return ok({
      tools: STEEL_AI_TOOLS.filter((tool) => inScope(tool.module)).map(
        (tool) => ({
          name: tool.name,
          label: tool.label,
          description: tool.description,
          module: tool.module,
          kind: tool.kind,
        }),
      ),
      events: STEEL_AGENT_EVENTS.filter((event) => inScope(event.module)).map(
        (event) => ({ ...event }),
      ),
      agentModeEnabled: settings.value?.agentModeEnabled ?? true,
      canManage: canManageSteelAgents(membership.value),
    })
  },

  async create(
    actorId: string,
    workspaceId: string,
    dto: CreateSteelAgentDTO,
  ): Promise<Result<SteelAgentDTO>> {
    const membership = await assertMember(actorId, workspaceId, {
      resource: RESOURCE,
      action: 'CREATE',
    })
    if (!membership.ok) return membership

    const owner = await validateOwner(dto.ownerId, workspaceId)
    if (!owner.ok) return owner
    const tools = await validateTools(workspaceId, dto.tools)
    if (!tools.ok) return tools

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
      tools: tools.value,
    })
    if (!created.ok) return created

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
      },
    })
    return ok(toSteelAgentDTO(created.value, kindOf))
  },

  async update(
    actorId: string,
    workspaceId: string,
    agentId: string,
    dto: UpdateSteelAgentDTO,
  ): Promise<Result<SteelAgentDTO>> {
    const membership = await assertMember(actorId, workspaceId, {
      resource: RESOURCE,
      action: 'EDIT',
    })
    if (!membership.ok) return membership

    const current = await SteelAgentRepository.findById(agentId, workspaceId)
    if (!current.ok) return current

    if (dto.ownerId && dto.ownerId !== current.value.ownerId) {
      const owner = await validateOwner(dto.ownerId, workspaceId)
      if (!owner.ok) return owner
    }
    let tools: SteelAgentToolInput[] | undefined
    if (dto.tools) {
      const validated = await validateTools(workspaceId, dto.tools)
      if (!validated.ok) return validated
      tools = validated.value
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

    const { tools: _tools, ...fields } = dto
    const updated = await SteelAgentRepository.update(
      agentId,
      { ...fields, ...normalizeSteelAgentTrigger(merged) },
      tools,
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
      },
    })
    return ok(toSteelAgentDTO(updated.value, kindOf))
  },

  async delete(
    actorId: string,
    workspaceId: string,
    agentId: string,
  ): Promise<Result<SteelAgentDTO>> {
    const membership = await assertMember(actorId, workspaceId, {
      resource: RESOURCE,
      action: 'DELETE',
    })
    if (!membership.ok) return membership
    const current = await SteelAgentRepository.findById(agentId, workspaceId)
    if (!current.ok) return current
    const deleted = await SteelAgentRepository.delete(agentId)
    if (!deleted.ok) return deleted
    auditMutation({
      entity: 'steel_agent',
      action: 'delete',
      actorId,
      targetId: agentId,
      meta: { workspaceId, name: current.value.name },
    })
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
