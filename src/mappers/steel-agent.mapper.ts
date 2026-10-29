import type {
  SteelAgentRun,
  SteelAgentRunStep,
  SteelAgentVersion,
} from '@prisma/client'
import type { AiToolKind } from '@/src/lib/ai/tools/types'
import { effectiveToolMode } from '@/src/lib/steel-agents/tool-mode'
import {
  emptyVersionStats,
  parseVersionTools,
  type VersionStats,
} from '@/src/lib/steel-agents/versions'
import type {
  SteelAgentRunDetail,
  SteelAgentWithRelations,
} from '@/src/repositories/steel-agent.repository'
import type {
  SteelAgentDTO,
  SteelAgentRunDetailDTO,
  SteelAgentRunDTO,
  SteelAgentRunStepDTO,
  SteelAgentVersionDTO,
  SteelAgentVersionRefDTO,
} from '@/types/steel-agent'
import { toAiPendingActionDTO } from './ai-pending-action.mapper'

function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null
}

/** Tool name → kind (registry lookup injected so the mapper stays pure). */
export type ToolKindLookup = (name: string) => AiToolKind | undefined
/** Tool name → pt-BR label. */
export type ToolLabelLookup = (name: string) => string | null

export function toSteelAgentDTO(
  agent: SteelAgentWithRelations,
  kindOf: ToolKindLookup,
): SteelAgentDTO {
  const [lastRun] = agent.runs
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    instructions: agent.instructions,
    triggerType: agent.triggerType,
    cron: agent.cron,
    timezone: agent.timezone,
    eventKey: agent.eventKey,
    enabled: agent.enabled,
    owner: agent.owner
      ? {
          id: agent.owner.id,
          name: agent.owner.name,
          email: agent.owner.email,
          image: agent.owner.image,
        }
      : null,
    createdById: agent.createdById,
    maxToolRounds: agent.maxToolRounds,
    monthlyRunCap: agent.monthlyRunCap,
    lastRunAt: iso(agent.lastRunAt),
    nextRunAt: iso(agent.nextRunAt),
    tools: agent.tools.map((tool) => ({
      toolName: tool.toolName,
      mode: effectiveToolMode(kindOf(tool.toolName), tool.mode),
    })),
    lastRun: lastRun
      ? {
          id: lastRun.id,
          status: lastRun.status,
          triggerType: lastRun.triggerType,
          createdAt: lastRun.createdAt.toISOString(),
          finishedAt: iso(lastRun.finishedAt),
        }
      : null,
    evalSetId: agent.evalSetId,
    evalMinPassRate: agent.evalMinPassRate,
    publishedVersionId: agent.publishedVersionId,
    challengerVersionId: agent.challengerVersionId,
    createdAt: agent.createdAt.toISOString(),
    updatedAt: agent.updatedAt.toISOString(),
  }
}

export function toSteelAgentVersionDTO(
  version: SteelAgentVersion,
  stats: VersionStats | undefined,
  kindOf: ToolKindLookup,
): SteelAgentVersionDTO {
  return {
    id: version.id,
    agentId: version.agentId,
    number: version.number,
    status: version.status,
    instructions: version.instructions,
    maxToolRounds: version.maxToolRounds,
    tools: parseVersionTools(version.tools).map((tool) => ({
      toolName: tool.toolName,
      mode: effectiveToolMode(kindOf(tool.toolName), tool.mode),
    })),
    changeNote: version.changeNote,
    rolloutPercent: version.rolloutPercent,
    evalRunId: version.evalRunId,
    evalPassed: version.evalPassed,
    evalTotal: version.evalTotal,
    evalPassRate:
      version.evalTotal && version.evalPassed !== null
        ? version.evalPassed / version.evalTotal
        : null,
    evalNote: version.evalNote,
    createdById: version.createdById,
    publishedAt: iso(version.publishedAt),
    resolvedAt: iso(version.resolvedAt),
    createdAt: version.createdAt.toISOString(),
    stats: stats ?? emptyVersionStats(),
  }
}

export function toSteelAgentVersionRefDTO(
  version: SteelAgentVersion,
): SteelAgentVersionRefDTO {
  return { id: version.id, number: version.number, status: version.status }
}

export function toSteelAgentRunDTO(run: SteelAgentRun): SteelAgentRunDTO {
  return {
    id: run.id,
    agentId: run.agentId,
    status: run.status,
    triggerType: run.triggerType,
    triggerPayload: run.triggerPayload ?? null,
    startedById: run.startedById,
    startedAt: iso(run.startedAt),
    finishedAt: iso(run.finishedAt),
    summary: run.summary,
    error: run.error,
    modelKey: run.modelKey,
    rounds: run.rounds,
    inputTokens: run.inputTokens,
    outputTokens: run.outputTokens,
    costUsd: Number(run.costUsd),
    isTest: run.isTest,
    rerunOfId: run.rerunOfId,
    versionId: run.versionId,
    createdAt: run.createdAt.toISOString(),
  }
}

export function toSteelAgentRunStepDTO(
  step: SteelAgentRunStep,
  labelOf: ToolLabelLookup,
  /**
   * The retrieved context (`output.context`, an excerpt of what a READ tool
   * returned) may hold records the viewer cannot open in the module; only
   * the owner or an admin gets it.
   */
  includeContext = true,
): SteelAgentRunStepDTO {
  let output: unknown = step.output ?? null
  if (!includeContext && output && typeof output === 'object') {
    const { context: _context, ...rest } = output as Record<string, unknown>
    output = rest
  }
  return {
    id: step.id,
    kind: step.kind,
    toolName: step.toolName,
    toolLabel: step.toolName ? labelOf(step.toolName) : null,
    pendingActionId: step.pendingActionId,
    input: step.input ?? null,
    output,
    status: step.status,
    error: step.error,
    createdAt: step.createdAt.toISOString(),
  }
}

export function toSteelAgentRunDetailDTO(
  run: SteelAgentRunDetail,
  input: { canApprove: boolean; labelOf: ToolLabelLookup },
): SteelAgentRunDetailDTO {
  return {
    ...toSteelAgentRunDTO(run),
    agent: {
      id: run.agent.id,
      name: run.agent.name,
      ownerId: run.agent.ownerId,
    },
    steps: run.steps.map((step) =>
      toSteelAgentRunStepDTO(step, input.labelOf, input.canApprove),
    ),
    pendingActions: run.pendingActions.map(toAiPendingActionDTO),
    canApprove: input.canApprove,
  }
}
