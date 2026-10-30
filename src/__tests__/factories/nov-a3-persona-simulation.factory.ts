import { createId } from '@paralleldrive/cuid2'
import {
  Prisma,
  type SteelAgent,
  type SteelAgentSimulation,
  type SteelAgentSimulationCase,
  type SteelAgentTool,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import type {
  SteelAgentSimulationDetail,
  SteelAgentSimulationForExecution,
  SteelAgentSimulationWithCases,
} from '@/src/repositories/steel-agent-simulation.repository'
import { createFakeSteelAgent } from './steel-agent.factory'

const NOW = new Date('2026-11-06T12:00:00.000Z')

export function createFakeSimulation(
  overrides?: Partial<SteelAgentSimulation>,
): SteelAgentSimulation {
  return {
    id: createId(),
    workspaceId: createId(),
    agentId: createId(),
    name: 'Simulação de teste',
    status: 'QUEUED',
    startedById: createId(),
    passScore: 70,
    totalCases: 1,
    passedCases: 0,
    failedCases: 0,
    avgScore: null,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: new Prisma.Decimal(0),
    modelKey: null,
    error: null,
    agentVersionId: null,
    startedAt: null,
    finishedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

export function createFakeSimulationCase(
  overrides?: Partial<SteelAgentSimulationCase>,
): SteelAgentSimulationCase {
  return {
    id: createId(),
    simulationId: createId(),
    position: 0,
    label: 'Cliente irritado',
    personaKey: 'irritated_customer',
    persona: 'Cliente sem paciência.',
    scenario: 'Internet fora desde ontem.',
    channel: 'WHATSAPP',
    openingMessage: 'Minha internet não volta!',
    criteria: ['Reconhece o problema', 'Informa o próximo passo'],
    maxTurns: 3,
    status: 'QUEUED',
    verdict: null,
    score: null,
    transcript: null,
    toolEvents: null,
    criteriaResults: null,
    judgeSummary: null,
    endReason: null,
    error: null,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: new Prisma.Decimal(0),
    startedAt: null,
    finishedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

export function createFakeSimulationWithCases(
  simulation?: Partial<SteelAgentSimulation>,
  cases?: Partial<SteelAgentSimulationCase>[],
): SteelAgentSimulationWithCases {
  const base = createFakeSimulation(simulation)
  const items = (cases ?? [{}]).map((item, position) =>
    createFakeSimulationCase({ simulationId: base.id, position, ...item }),
  )
  return { ...base, totalCases: items.length, cases: items }
}

export function createFakeSimulationDetail(
  simulation?: Partial<SteelAgentSimulation>,
  cases?: Partial<SteelAgentSimulationCase>[],
  agent?: Partial<Pick<SteelAgent, 'id' | 'name' | 'ownerId'>>,
): SteelAgentSimulationDetail {
  const base = createFakeSimulationWithCases(simulation, cases)
  return {
    ...base,
    agent: {
      id: base.agentId,
      name: 'Triagem de chamados',
      ownerId: createId(),
      ...agent,
    },
  }
}

export function createFakeSimulationForExecution(
  simulation?: Partial<SteelAgentSimulation>,
  cases?: Partial<SteelAgentSimulationCase>[],
  agent?: Partial<SteelAgent> & { tools?: SteelAgentTool[] },
): SteelAgentSimulationForExecution {
  const { tools = [], ...agentFields } = agent ?? {}
  const base = createFakeSimulationWithCases(simulation, cases)
  const fakeAgent = createFakeSteelAgent({
    id: base.agentId,
    workspaceId: base.workspaceId,
    ...agentFields,
  })
  return { ...base, agent: { ...fakeAgent, tools } }
}

export async function seedSimulation(data: {
  workspaceId: string
  agentId: string
  startedById?: string | null
  name?: string
  status?: SteelAgentSimulation['status']
  updatedAt?: Date
  cases?: Partial<
    Pick<
      SteelAgentSimulationCase,
      'label' | 'status' | 'verdict' | 'score' | 'maxTurns'
    >
  >[]
}) {
  const { cases = [{}], updatedAt, ...fields } = data
  const simulation = await prisma.steelAgentSimulation.create({
    data: {
      name: 'Seed simulation',
      totalCases: cases.length,
      ...fields,
      cases: {
        create: cases.map((item, position) => ({
          label: 'Cliente irritado',
          persona: 'Cliente sem paciência.',
          scenario: 'Internet fora.',
          openingMessage: 'Minha internet não volta!',
          criteria: ['Reconhece o problema'],
          ...item,
          position,
        })),
      },
    },
    include: { cases: { orderBy: { position: 'asc' } } },
  })
  if (updatedAt) {
    // `@updatedAt` ignores explicit writes; raw SQL backdates the row.
    await prisma.$executeRaw`UPDATE steel_agent_simulations SET updated_at = ${updatedAt} WHERE id = ${simulation.id}`
  }
  return simulation
}
