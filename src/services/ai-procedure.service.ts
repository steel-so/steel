import type { ModuleKind, Prisma } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import {
  aiProcedureInvalid,
  aiProcedureLimitReached,
  aiProcedureVersionNotFound,
  forbidden,
} from '@/src/errors/app-error'
import { STEEL_AI_TOOLS } from '@/src/lib/ai/tools'
import { findTool } from '@/src/lib/ai/tools/registry'
import { currentPeriodStart } from '@/src/lib/ai/quota'
import { planFor } from '@/src/lib/ai/procedures/engine'
import { procedureProblems } from '@/src/lib/ai/procedures/validate'
import { err, ok, type Result } from '@/src/lib/result'
import {
  toAiProcedureDTO,
  toAiProcedureRunDetailDTO,
  toAiProcedureRunDTO,
  toAiProcedureVersionDTO,
} from '@/src/mappers/ai-procedure.mapper'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { AiProcedureRepository } from '@/src/repositories/ai-procedure.repository'
import { AiProcedureRunRepository } from '@/src/repositories/ai-procedure-run.repository'
import { SteelAgentRepository } from '@/src/repositories/steel-agent.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import {
  type CreateAiProcedureDTO,
  type ListAiProcedureRunsQueryDTO,
  PROCEDURE_LIMITS,
  PROCEDURE_PRESET_VARIABLES,
  type PreviewAiProcedureDTO,
  type ProcedureStep,
  type UpdateAiProcedureDTO,
} from '@/src/schemas/ai-procedure.schema'
import {
  CHATBOT_CONDITION_OPERATORS,
  CHATBOT_QUESTION_VALIDATIONS,
} from '@/src/schemas/whatsapp-chatbot.schema'
import type {
  AiProcedureCatalogDTO,
  AiProcedureDTO,
  AiProcedurePreviewDTO,
  AiProcedureRunDetailDTO,
  AiProcedureRunDTO,
  AiProcedureVersionDTO,
} from '@/types/ai-procedure'
import { assertMember, type MembershipContext } from './authz'
import { canManageSteelAgents } from './steel-agent.service'

/**
 * Procedures (A5): CRUD, version history, preview and run history. RBAC
 * reuses the `steel-agents` resource: members read, admins manage. The
 * execution itself is `ai-procedure-runtime.service.ts`.
 */

const RESOURCE = 'steel-agents'

async function enabledModules(
  workspaceId: string,
): Promise<Result<ModuleKind[]>> {
  const modules =
    await WorkspaceModuleAccessRepository.listByWorkspace(workspaceId)
  if (!modules.ok) return modules
  return ok(modules.value.filter((m) => m.enabled).map((m) => m.module))
}

/** Steps → problems the engine would hit (structure + TOOL availability). */
async function validateSteps(
  workspaceId: string,
  steps: readonly ProcedureStep[],
): Promise<Result<true>> {
  const problems = procedureProblems(steps)
  const toolSteps = steps.filter((s) => s.kind === 'TOOL')
  if (toolSteps.length > 0) {
    const modules = await enabledModules(workspaceId)
    if (!modules.ok) return modules
    for (const step of toolSteps) {
      if (step.kind !== 'TOOL') continue
      const tool = findTool(step.toolName)
      if (!tool || (tool.module && !modules.value.includes(tool.module))) {
        problems.push(
          `Passo "${step.title}": a ferramenta "${step.toolName}" não existe ou não está disponível`,
        )
      } else if (tool.kind !== 'READ') {
        problems.push(
          `Passo "${step.title}": só ferramentas de leitura podem rodar em um procedimento`,
        )
      }
    }
  }
  return problems.length > 0
    ? err(aiProcedureInvalid(problems.join('; ')))
    : ok(true)
}

async function validateOwnerAndAgents(
  workspaceId: string,
  ownerId: string | null,
  agentIds: string[],
): Promise<Result<true>> {
  if (ownerId) {
    const membership = await MembershipRepository.findByUserAndWorkspace(
      ownerId,
      workspaceId,
    )
    if (!membership.ok) return membership
    if (!membership.value) {
      return err(aiProcedureInvalid('O responsável não é membro do workspace'))
    }
  }
  if (agentIds.length > 0) {
    const agents = await SteelAgentRepository.listByWorkspace(workspaceId)
    if (!agents.ok) return agents
    const known = new Set(agents.value.map((agent) => agent.id))
    if (agentIds.some((id) => !known.has(id))) {
      return err(aiProcedureInvalid('Um dos agentes não existe neste workspace'))
    }
  }
  return ok(true)
}

function requireManage(membership: MembershipContext): Result<true> {
  return canManageSteelAgents(membership) ? ok(true) : err(forbidden())
}

const sameJson = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b)

export const AiProcedureService = {
  async list(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<AiProcedureDTO[]>> {
    const membership = await assertMember(actorId, workspaceId, {
      resource: RESOURCE,
      action: 'VIEW',
    })
    if (!membership.ok) return membership
    const [list, counts] = await Promise.all([
      AiProcedureRepository.list(workspaceId),
      AiProcedureRunRepository.countsSince(workspaceId, currentPeriodStart()),
    ])
    if (!list.ok) return list
    if (!counts.ok) return counts
    return ok(
      list.value.map((p) => toAiProcedureDTO(p, counts.value[p.id] ?? 0)),
    )
  },

  async get(
    actorId: string,
    workspaceId: string,
    id: string,
  ): Promise<Result<AiProcedureDTO>> {
    const membership = await assertMember(actorId, workspaceId, {
      resource: RESOURCE,
      action: 'VIEW',
    })
    if (!membership.ok) return membership
    const found = await AiProcedureRepository.findById(id, workspaceId)
    if (!found.ok) return found
    const runs = await AiProcedureRunRepository.countSince(
      id,
      currentPeriodStart(),
    )
    if (!runs.ok) return runs
    return ok(toAiProcedureDTO(found.value, runs.value))
  },

  async catalog(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<AiProcedureCatalogDTO>> {
    const membership = await assertMember(actorId, workspaceId, {
      resource: RESOURCE,
      action: 'VIEW',
    })
    if (!membership.ok) return membership
    const [modules, agents] = await Promise.all([
      enabledModules(workspaceId),
      SteelAgentRepository.listByWorkspace(workspaceId),
    ])
    if (!modules.ok) return modules
    if (!agents.ok) return agents
    return ok({
      validations: [...CHATBOT_QUESTION_VALIDATIONS],
      operators: [...CHATBOT_CONDITION_OPERATORS],
      tools: STEEL_AI_TOOLS.filter(
        (tool) =>
          tool.kind === 'READ' &&
          (!tool.module || modules.value.includes(tool.module)),
      ).map((tool) => ({
        name: tool.name,
        label: tool.label,
        description: tool.description,
      })),
      agents: agents.value.map((agent) => ({
        id: agent.id,
        name: agent.name,
      })),
      presetVariables: [...PROCEDURE_PRESET_VARIABLES],
      limits: {
        procedures: PROCEDURE_LIMITS.procedures,
        steps: PROCEDURE_LIMITS.steps,
      },
      canManage: canManageSteelAgents(membership.value),
    })
  },

  async create(
    actorId: string,
    workspaceId: string,
    dto: CreateAiProcedureDTO,
  ): Promise<Result<AiProcedureDTO>> {
    const membership = await assertMember(actorId, workspaceId, {
      resource: RESOURCE,
      action: 'CREATE',
    })
    if (!membership.ok) return membership
    const allowed = requireManage(membership.value)
    if (!allowed.ok) return allowed

    const count = await AiProcedureRepository.count(workspaceId)
    if (!count.ok) return count
    if (count.value >= PROCEDURE_LIMITS.procedures) {
      return err(aiProcedureLimitReached(PROCEDURE_LIMITS.procedures))
    }

    const hasTool = dto.steps.some((s) => s.kind === 'TOOL')
    const ownerId = dto.ownerId ?? (hasTool ? actorId : null)
    const valid = await validateSteps(workspaceId, dto.steps)
    if (!valid.ok) return valid
    const links = await validateOwnerAndAgents(
      workspaceId,
      ownerId,
      dto.agentIds,
    )
    if (!links.ok) return links

    const created = await AiProcedureRepository.create(workspaceId, actorId, {
      name: dto.name,
      description: dto.description ?? null,
      whenToUse: dto.whenToUse,
      steps: dto.steps as unknown as Prisma.InputJsonValue,
      maxAttempts: dto.maxAttempts,
      handoffMessage: dto.handoffMessage ?? null,
      whatsappEnabled: dto.whatsappEnabled,
      agentIds: dto.agentIds,
      ownerId,
      status: dto.status,
    })
    if (!created.ok) return created
    auditMutation({
      entity: 'ai_procedure',
      action: 'create',
      actorId,
      targetId: created.value.id,
      meta: { workspaceId, steps: dto.steps.length, status: dto.status },
    })
    return ok(toAiProcedureDTO(created.value))
  },

  async update(
    actorId: string,
    workspaceId: string,
    id: string,
    dto: UpdateAiProcedureDTO,
  ): Promise<Result<AiProcedureDTO>> {
    const membership = await assertMember(actorId, workspaceId, {
      resource: RESOURCE,
      action: 'EDIT',
    })
    if (!membership.ok) return membership
    const allowed = requireManage(membership.value)
    if (!allowed.ok) return allowed

    const found = await AiProcedureRepository.findById(id, workspaceId)
    if (!found.ok) return found
    const current = found.value

    const steps = dto.steps ?? (current.steps as unknown as ProcedureStep[])
    if (dto.steps) {
      const valid = await validateSteps(workspaceId, steps)
      if (!valid.ok) return valid
    }
    const ownerId =
      dto.ownerId !== undefined
        ? dto.ownerId
        : (current.ownerId ??
          (steps.some((s) => s.kind === 'TOOL') ? actorId : null))
    const agentIds = dto.agentIds ?? current.agentIds
    if (dto.ownerId !== undefined || dto.agentIds) {
      const links = await validateOwnerAndAgents(workspaceId, ownerId, agentIds)
      if (!links.ok) return links
    }

    const next = {
      name: dto.name ?? current.name,
      description:
        dto.description !== undefined ? dto.description : current.description,
      whenToUse: dto.whenToUse ?? current.whenToUse,
      steps: steps as unknown as Prisma.InputJsonValue,
      maxAttempts: dto.maxAttempts ?? current.maxAttempts,
      handoffMessage:
        dto.handoffMessage !== undefined
          ? dto.handoffMessage
          : current.handoffMessage,
      whatsappEnabled: dto.whatsappEnabled ?? current.whatsappEnabled,
      agentIds,
      ownerId,
      status: dto.status ?? current.status,
    }
    const changesDefinition =
      next.whenToUse !== current.whenToUse ||
      next.maxAttempts !== current.maxAttempts ||
      next.handoffMessage !== current.handoffMessage ||
      !sameJson(next.steps, current.steps)

    const saved = await AiProcedureRepository.update(
      id,
      workspaceId,
      next,
      changesDefinition
        ? { changeNote: dto.changeNote ?? null, createdById: actorId }
        : undefined,
    )
    if (!saved.ok) return saved
    auditMutation({
      entity: 'ai_procedure',
      action: 'update',
      actorId,
      targetId: id,
      meta: {
        workspaceId,
        version: saved.value.currentVersion,
        newVersion: changesDefinition,
        status: next.status,
      },
    })
    return ok(toAiProcedureDTO(saved.value))
  },

  async remove(
    actorId: string,
    workspaceId: string,
    id: string,
  ): Promise<Result<AiProcedureDTO>> {
    const membership = await assertMember(actorId, workspaceId, {
      resource: RESOURCE,
      action: 'DELETE',
    })
    if (!membership.ok) return membership
    const allowed = requireManage(membership.value)
    if (!allowed.ok) return allowed
    const removed = await AiProcedureRepository.delete(id, workspaceId)
    if (!removed.ok) return removed
    auditMutation({
      entity: 'ai_procedure',
      action: 'delete',
      actorId,
      targetId: id,
      meta: { workspaceId },
    })
    return ok(toAiProcedureDTO(removed.value))
  },

  /** What would run for the given known variables (no AI, no side effects). */
  async preview(
    actorId: string,
    workspaceId: string,
    id: string,
    dto: PreviewAiProcedureDTO,
  ): Promise<Result<AiProcedurePreviewDTO>> {
    const membership = await assertMember(actorId, workspaceId, {
      resource: RESOURCE,
      action: 'VIEW',
    })
    if (!membership.ok) return membership
    const found = await AiProcedureRepository.findById(id, workspaceId)
    if (!found.ok) return found
    const steps = found.value.steps as unknown as ProcedureStep[]
    return ok({
      problems: procedureProblems(steps),
      plan: planFor({ steps }, dto.variables),
    })
  },

  async listVersions(
    actorId: string,
    workspaceId: string,
    id: string,
  ): Promise<Result<AiProcedureVersionDTO[]>> {
    const membership = await assertMember(actorId, workspaceId, {
      resource: RESOURCE,
      action: 'VIEW',
    })
    if (!membership.ok) return membership
    const found = await AiProcedureRepository.findById(id, workspaceId)
    if (!found.ok) return found
    const versions = await AiProcedureRepository.listVersions(id)
    if (!versions.ok) return versions
    return ok(
      versions.value.map((v) =>
        toAiProcedureVersionDTO(v, found.value.currentVersion),
      ),
    )
  },

  /** Brings an old version back as a new one (history is never rewritten). */
  async restoreVersion(
    actorId: string,
    workspaceId: string,
    id: string,
    versionId: string,
    changeNote?: string | null,
  ): Promise<Result<AiProcedureDTO>> {
    const membership = await assertMember(actorId, workspaceId, {
      resource: RESOURCE,
      action: 'EDIT',
    })
    if (!membership.ok) return membership
    const allowed = requireManage(membership.value)
    if (!allowed.ok) return allowed
    const found = await AiProcedureRepository.findById(id, workspaceId)
    if (!found.ok) return found
    const version = await AiProcedureRepository.findVersion(id, versionId)
    if (!version.ok) return version
    if (!version.value) return err(aiProcedureVersionNotFound())

    const steps = version.value.steps as unknown as ProcedureStep[]
    const valid = await validateSteps(workspaceId, steps)
    if (!valid.ok) return valid
    const saved = await AiProcedureRepository.update(
      id,
      workspaceId,
      {
        whenToUse: version.value.whenToUse,
        steps: version.value.steps as Prisma.InputJsonValue,
        maxAttempts: version.value.maxAttempts,
        handoffMessage: version.value.handoffMessage,
      },
      {
        changeNote:
          changeNote ?? `Restaurada da versão ${version.value.number}`,
        createdById: actorId,
      },
    )
    if (!saved.ok) return saved
    auditMutation({
      entity: 'ai_procedure',
      action: 'update',
      actorId,
      targetId: id,
      meta: {
        workspaceId,
        restoredFrom: version.value.number,
        version: saved.value.currentVersion,
      },
    })
    return ok(toAiProcedureDTO(saved.value))
  },

  async listRuns(
    actorId: string,
    workspaceId: string,
    procedureId: string | null,
    query: ListAiProcedureRunsQueryDTO,
  ): Promise<Result<AiProcedureRunDTO[]>> {
    const membership = await assertMember(actorId, workspaceId, {
      resource: RESOURCE,
      action: 'VIEW',
    })
    if (!membership.ok) return membership
    if (procedureId) {
      const found = await AiProcedureRepository.findById(
        procedureId,
        workspaceId,
      )
      if (!found.ok) return found
    }
    const runs = await AiProcedureRunRepository.list(workspaceId, {
      ...(procedureId && { procedureId }),
      ...(query.status && { status: query.status }),
      limit: query.limit,
    })
    if (!runs.ok) return runs
    return ok(runs.value.map(toAiProcedureRunDTO))
  },

  async getRun(
    actorId: string,
    workspaceId: string,
    runId: string,
  ): Promise<Result<AiProcedureRunDetailDTO>> {
    const membership = await assertMember(actorId, workspaceId, {
      resource: RESOURCE,
      action: 'VIEW',
    })
    if (!membership.ok) return membership
    const run = await AiProcedureRunRepository.findDetail(runId, workspaceId)
    if (!run.ok) return run
    return ok(toAiProcedureRunDetailDTO(run.value))
  },
}
