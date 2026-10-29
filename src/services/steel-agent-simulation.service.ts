import { auditMutation } from '@/lib/axiom/audit'
import { logFields } from '@/lib/axiom/log-fields'
import { logger } from '@/lib/axiom/logger'
import { forbidden } from '@/src/errors'
import {
  aiDisabled,
  steelAgentSimulationGenerationFailed,
  steelAgentSimulationInProgress,
  steelAgentSimulationNotFound,
} from '@/src/errors/app-error'
import { findTool, resolveToolAccess } from '@/src/lib/ai/tools/registry'
import type { AiUsageTokens } from '@/src/lib/ai/types'
import { err, ok, type Result } from '@/src/lib/result'
import { enqueueSteelAgentSimulation } from '@/src/lib/steel-agents/enqueue'
import {
  buildGenerationSystemPrompt,
  buildGenerationUserMessage,
  GENERATION_SCHEMA,
  parseGeneratedScenarios,
} from '@/src/lib/steel-agents/simulation/prompts'
import {
  toSteelAgentSimulationDetailDTO,
  toSteelAgentSimulationDTO,
} from '@/src/mappers/steel-agent-simulation.mapper'
import { SteelAgentRepository } from '@/src/repositories/steel-agent.repository'
import {
  type SteelAgentSimulationCaseInput,
  SteelAgentSimulationRepository,
} from '@/src/repositories/steel-agent-simulation.repository'
import type {
  CreateSteelAgentSimulationDTO,
  GenerateSteelAgentScenariosDTO,
  ListSteelAgentSimulationsQueryDTO,
} from '@/src/schemas/steel-agent-simulation.schema'
import type {
  SteelAgentSimulationDetailDTO,
  SteelAgentSimulationDTO,
  SteelAgentSimulationScenarioDraftDTO,
} from '@/types/steel-agent-simulation'
import { AiUsageService } from './ai-usage.service'
import { assertMember } from './authz'
import { canManageSteelAgents } from './steel-agent.service'

/**
 * Persona simulations of a Steel Agent (A3): whole conversations between an
 * AI-played customer and the agent, scored by an AI judge. Same gate as
 * "Testar agente": the agent's owner or a `steel-agents` manager. The
 * conversations run in the worker (`steel-agent-simulation-runner.ts`).
 */

const RESOURCE = 'steel-agents'

/** Membership + agent + "owner or manager" gate shared by the actions. */
async function loadAgentForSimulation(
  actorId: string,
  workspaceId: string,
  agentId: string,
) {
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
  return ok({ agent: agent.value, membership: membership.value })
}

async function start(
  actorId: string,
  workspaceId: string,
  agentId: string,
  input: {
    name: string
    passScore: number
    cases: SteelAgentSimulationCaseInput[]
    origin: 'create' | 'rerun'
  },
): Promise<Result<SteelAgentSimulationDTO>> {
  const loaded = await loadAgentForSimulation(actorId, workspaceId, agentId)
  if (!loaded.ok) return loaded

  const active = await SteelAgentSimulationRepository.hasActive(agentId)
  if (!active.ok) return active
  if (active.value) return err(steelAgentSimulationInProgress())

  const created = await SteelAgentSimulationRepository.create({
    workspaceId,
    agentId,
    name: input.name,
    startedById: actorId,
    passScore: input.passScore,
    cases: input.cases,
  })
  if (!created.ok) return created

  const queued = await enqueueSteelAgentSimulation(created.value.id)
  if (!queued.ok) {
    await SteelAgentSimulationRepository.update(created.value.id, {
      status: 'FAILED',
      error: queued.error.message,
      finishedAt: new Date(),
    })
    return queued
  }

  auditMutation({
    entity: 'steel_agent_simulation',
    action: 'start',
    actorId,
    targetId: created.value.id,
    meta: {
      workspaceId,
      agentId,
      cases: input.cases.length,
      origin: input.origin,
    },
  })
  logger.info(
    'steel_agents.simulation_requested',
    logFields(
      { component: 'SteelAgentSimulationService', workspaceId },
      { agentId, simulationId: created.value.id, cases: input.cases.length },
    ),
  )
  return ok(toSteelAgentSimulationDTO(created.value))
}

export const SteelAgentSimulationService = {
  /** Queues a simulation with the given scenarios. */
  async create(
    actorId: string,
    workspaceId: string,
    agentId: string,
    dto: CreateSteelAgentSimulationDTO,
  ): Promise<Result<SteelAgentSimulationDTO>> {
    return start(actorId, workspaceId, agentId, {
      name: dto.name ?? defaultName(),
      passScore: dto.passScore,
      origin: 'create',
      cases: dto.scenarios.map((scenario) => ({
        label: scenario.label,
        personaKey: scenario.personaKey ?? null,
        persona: scenario.persona,
        scenario: scenario.scenario,
        channel: scenario.channel,
        openingMessage: scenario.openingMessage,
        criteria: scenario.criteria,
        maxTurns: scenario.maxTurns,
      })),
    })
  },

  /** Runs the same scenarios again (e.g. after editing the agent). */
  async rerun(
    actorId: string,
    workspaceId: string,
    agentId: string,
    simulationId: string,
  ): Promise<Result<SteelAgentSimulationDTO>> {
    const loaded = await loadAgentForSimulation(actorId, workspaceId, agentId)
    if (!loaded.ok) return loaded
    const previous = await SteelAgentSimulationRepository.findDetail(
      simulationId,
      workspaceId,
    )
    if (!previous.ok) return previous
    if (previous.value.agentId !== agentId) {
      return err(steelAgentSimulationNotFound())
    }
    return start(actorId, workspaceId, agentId, {
      name: `${previous.value.name} (repetição)`.slice(0, 120),
      passScore: previous.value.passScore,
      origin: 'rerun',
      cases: previous.value.cases.map((item) => ({
        label: item.label,
        personaKey: item.personaKey,
        persona: item.persona,
        scenario: item.scenario,
        channel: item.channel,
        openingMessage: item.openingMessage,
        criteria: Array.isArray(item.criteria)
          ? (item.criteria as string[])
          : [],
        maxTurns: item.maxTurns,
      })),
    })
  },

  /**
   * "Gerar cenários": asks the model for scenario drafts from the agent's
   * instructions and tools. Nothing is saved; the admin edits and runs them.
   */
  async generateScenarios(
    actorId: string,
    workspaceId: string,
    agentId: string,
    dto: GenerateSteelAgentScenariosDTO,
  ): Promise<Result<SteelAgentSimulationScenarioDraftDTO[]>> {
    const loaded = await loadAgentForSimulation(actorId, workspaceId, agentId)
    if (!loaded.ok) return loaded
    const { agent } = loaded.value

    const access = await resolveToolAccess(actorId, workspaceId)
    if (!access.ok) return access
    if (!access.value.aiEnabled) return err(aiDisabled())

    const prepared = await AiUsageService.prepare(
      workspaceId,
      'STEEL_AGENT',
      actorId,
    )
    if (!prepared.ok) return prepared
    const call = prepared.value
    const usage: AiUsageTokens = { inputTokens: 0, outputTokens: 0 }
    try {
      const response = await call.provider.chat({
        model: call.model.model,
        system: buildGenerationSystemPrompt(),
        messages: [
          {
            role: 'user',
            content: buildGenerationUserMessage({
              agentName: agent.name,
              instructions: agent.instructions,
              toolLabels: agent.tools.map(
                (tool) => findTool(tool.toolName)?.label ?? tool.toolName,
              ),
              count: dto.count,
              focus: dto.focus,
            }),
          },
        ],
        jsonSchema: GENERATION_SCHEMA,
        maxTokens: 4_000,
      })
      usage.inputTokens = response.usage.inputTokens
      usage.outputTokens = response.usage.outputTokens
      const drafts = parseGeneratedScenarios(response.text, dto.count)
      if (drafts.length === 0) {
        return err(steelAgentSimulationGenerationFailed())
      }
      return ok(drafts)
    } catch (cause) {
      logger.error(
        'steel_agents.simulation_generate_failed',
        logFields(
          {
            component: 'SteelAgentSimulationService',
            workspaceId,
            message: cause instanceof Error ? cause.message : String(cause),
          },
          { agentId },
        ),
      )
      return err(steelAgentSimulationGenerationFailed())
    } finally {
      await AiUsageService.record(call, {
        workspaceId,
        userId: actorId,
        usage,
      })
    }
  },

  async list(
    actorId: string,
    workspaceId: string,
    agentId: string,
    query: ListSteelAgentSimulationsQueryDTO,
  ): Promise<Result<SteelAgentSimulationDTO[]>> {
    const membership = await assertMember(actorId, workspaceId, {
      resource: RESOURCE,
      action: 'VIEW',
    })
    if (!membership.ok) return membership
    const agent = await SteelAgentRepository.findById(agentId, workspaceId)
    if (!agent.ok) return agent
    const simulations = await SteelAgentSimulationRepository.listByAgent(
      agentId,
      query.limit,
    )
    if (!simulations.ok) return simulations
    return ok(simulations.value.map(toSteelAgentSimulationDTO))
  },

  async get(
    actorId: string,
    workspaceId: string,
    agentId: string,
    simulationId: string,
  ): Promise<Result<SteelAgentSimulationDetailDTO>> {
    const membership = await assertMember(actorId, workspaceId, {
      resource: RESOURCE,
      action: 'VIEW',
    })
    if (!membership.ok) return membership
    const simulation = await SteelAgentSimulationRepository.findDetail(
      simulationId,
      workspaceId,
    )
    if (!simulation.ok) return simulation
    if (simulation.value.agentId !== agentId) {
      return err(steelAgentSimulationNotFound())
    }
    return ok(toSteelAgentSimulationDetailDTO(simulation.value))
  },

  async delete(
    actorId: string,
    workspaceId: string,
    agentId: string,
    simulationId: string,
  ): Promise<Result<SteelAgentSimulationDTO>> {
    const membership = await assertMember(actorId, workspaceId, {
      resource: RESOURCE,
      action: 'DELETE',
    })
    if (!membership.ok) return membership
    const simulation = await SteelAgentSimulationRepository.findDetail(
      simulationId,
      workspaceId,
    )
    if (!simulation.ok) return simulation
    if (simulation.value.agentId !== agentId) {
      return err(steelAgentSimulationNotFound())
    }
    const deleted = await SteelAgentSimulationRepository.delete(simulationId)
    if (!deleted.ok) return deleted
    auditMutation({
      entity: 'steel_agent_simulation',
      action: 'delete',
      actorId,
      targetId: simulationId,
      meta: { workspaceId, agentId },
    })
    return ok(toSteelAgentSimulationDTO(simulation.value))
  },
}

function defaultName(): string {
  return `Simulação de ${new Date().toISOString().slice(0, 10)}`
}
