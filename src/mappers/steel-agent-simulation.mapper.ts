import type {
  SteelAgentSimulation,
  SteelAgentSimulationCase,
} from '@prisma/client'
import { isSimulationChannel } from '@/src/lib/steel-agents/simulation/personas'
import type { SteelAgentSimulationDetail } from '@/src/repositories/steel-agent-simulation.repository'
import type {
  SteelAgentSimulationCaseDTO,
  SteelAgentSimulationCriterionResultDTO,
  SteelAgentSimulationDetailDTO,
  SteelAgentSimulationDTO,
  SteelAgentSimulationToolEventDTO,
  SteelAgentSimulationTurnDTO,
} from '@/types/steel-agent-simulation'

function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null
}

function list<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

export function toSteelAgentSimulationCaseDTO(
  item: SteelAgentSimulationCase,
): SteelAgentSimulationCaseDTO {
  return {
    id: item.id,
    position: item.position,
    label: item.label,
    personaKey: item.personaKey,
    persona: item.persona,
    scenario: item.scenario,
    channel: isSimulationChannel(item.channel) ? item.channel : 'WHATSAPP',
    openingMessage: item.openingMessage,
    criteria: list<string>(item.criteria),
    maxTurns: item.maxTurns,
    status: item.status,
    verdict: item.verdict,
    score: item.score,
    transcript: list<SteelAgentSimulationTurnDTO>(item.transcript),
    toolEvents: list<SteelAgentSimulationToolEventDTO>(item.toolEvents),
    criteriaResults: list<SteelAgentSimulationCriterionResultDTO>(
      item.criteriaResults,
    ),
    judgeSummary: item.judgeSummary,
    endReason: item.endReason,
    error: item.error,
    costUsd: Number(item.costUsd),
    startedAt: iso(item.startedAt),
    finishedAt: iso(item.finishedAt),
  }
}

export function toSteelAgentSimulationDTO(
  simulation: SteelAgentSimulation,
): SteelAgentSimulationDTO {
  return {
    id: simulation.id,
    agentId: simulation.agentId,
    name: simulation.name,
    status: simulation.status,
    startedById: simulation.startedById,
    passScore: simulation.passScore,
    totalCases: simulation.totalCases,
    passedCases: simulation.passedCases,
    failedCases: simulation.failedCases,
    avgScore: simulation.avgScore,
    inputTokens: simulation.inputTokens,
    outputTokens: simulation.outputTokens,
    costUsd: Number(simulation.costUsd),
    modelKey: simulation.modelKey,
    error: simulation.error,
    startedAt: iso(simulation.startedAt),
    finishedAt: iso(simulation.finishedAt),
    createdAt: simulation.createdAt.toISOString(),
  }
}

export function toSteelAgentSimulationDetailDTO(
  simulation: SteelAgentSimulationDetail,
): SteelAgentSimulationDetailDTO {
  return {
    ...toSteelAgentSimulationDTO(simulation),
    agentName: simulation.agent.name,
    cases: simulation.cases.map(toSteelAgentSimulationCaseDTO),
  }
}
