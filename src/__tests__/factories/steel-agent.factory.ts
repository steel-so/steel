import { createId } from '@paralleldrive/cuid2'
import {
  Prisma,
  type SteelAgent,
  type SteelAgentRun,
  type SteelAgentRunStep,
  type SteelAgentTool,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import type {
  SteelAgentRunDetail,
  SteelAgentRunWithAgent,
  SteelAgentWithRelations,
} from '@/src/repositories/steel-agent.repository'

const NOW = new Date('2026-10-06T12:00:00.000Z')

export function createFakeSteelAgent(
  overrides?: Partial<SteelAgent>,
): SteelAgent {
  return {
    id: createId(),
    workspaceId: createId(),
    name: 'Triagem de chamados',
    description: 'Classifica chamados novos',
    instructions: 'Classifique cada chamado novo.',
    triggerType: 'MANUAL',
    cron: null,
    timezone: 'America/Sao_Paulo',
    eventKey: null,
    enabled: true,
    ownerId: createId(),
    createdById: createId(),
    maxToolRounds: 8,
    monthlyRunCap: null,
    evalSetId: null,
    evalMinPassRate: 0.8,
    simGateEnabled: false,
    simGateMinPassRate: 0.8,
    publishedVersionId: null,
    challengerVersionId: null,
    lastRunAt: null,
    nextRunAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

export function createFakeSteelAgentTool(
  overrides?: Partial<SteelAgentTool>,
): SteelAgentTool {
  return {
    id: createId(),
    agentId: createId(),
    toolName: 'sd_list_tickets',
    mode: 'APPROVAL',
    createdAt: NOW,
    ...overrides,
  }
}

export function createFakeSteelAgentWithRelations(
  overrides?: Partial<SteelAgentWithRelations>,
): SteelAgentWithRelations {
  const agent = createFakeSteelAgent(overrides)
  return {
    ...agent,
    tools: [],
    owner: agent.ownerId
      ? {
          id: agent.ownerId,
          name: 'Ana Dona',
          email: 'ana@example.com',
          image: null,
        }
      : null,
    runs: [],
    ...overrides,
  }
}

export function createFakeSteelAgentRun(
  overrides?: Partial<SteelAgentRun>,
): SteelAgentRun {
  return {
    id: createId(),
    workspaceId: createId(),
    agentId: createId(),
    status: 'QUEUED',
    triggerType: 'MANUAL',
    triggerPayload: null,
    startedById: null,
    startedAt: null,
    finishedAt: null,
    summary: null,
    error: null,
    modelKey: null,
    rounds: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: new Prisma.Decimal(0),
    state: null,
    isTest: false,
    rerunOfId: null,
    versionId: null,
    parentRunId: null,
    depth: 0,
    delegatedCostUsd: new Prisma.Decimal(0),
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

export function createFakeSteelAgentRunWithAgent(
  run?: Partial<SteelAgentRun>,
  agent?: Partial<SteelAgent> & { tools?: SteelAgentTool[] },
): SteelAgentRunWithAgent {
  const { tools = [], ...agentFields } = agent ?? {}
  const fakeAgent = createFakeSteelAgent(agentFields)
  const fakeRun = createFakeSteelAgentRun({
    agentId: fakeAgent.id,
    workspaceId: fakeAgent.workspaceId,
    ...run,
  })
  return { ...fakeRun, agent: { ...fakeAgent, tools } }
}

export function createFakeSteelAgentRunStep(
  overrides?: Partial<SteelAgentRunStep>,
): SteelAgentRunStep {
  return {
    id: createId(),
    runId: createId(),
    kind: 'TOOL',
    toolName: 'sd_list_tickets',
    toolCallId: 'call_1',
    pendingActionId: null,
    input: {},
    output: { summary: '3 chamados' },
    status: 'OK',
    error: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

export function createFakeSteelAgentRunDetail(
  overrides?: Partial<SteelAgentRunDetail>,
): SteelAgentRunDetail {
  const run = createFakeSteelAgentRun(overrides)
  return {
    ...run,
    agent: { id: run.agentId, name: 'Triagem', ownerId: createId() },
    steps: [],
    pendingActions: [],
    ...overrides,
  }
}

/** Integration: persists an agent (and optional tools). */
export async function seedSteelAgent(data: {
  workspaceId: string
  ownerId?: string | null
  createdById?: string | null
  name?: string
  triggerType?: SteelAgent['triggerType']
  cron?: string | null
  eventKey?: string | null
  enabled?: boolean
  lastRunAt?: Date | null
  tools?: { toolName: string; mode: SteelAgentTool['mode'] }[]
}) {
  const { tools = [], ...fields } = data
  return prisma.steelAgent.create({
    data: {
      name: 'Seed agent',
      instructions: 'Faça a triagem.',
      triggerType: 'MANUAL',
      ...fields,
      tools: { create: tools },
    },
  })
}

export async function seedSteelAgentRun(data: {
  workspaceId: string
  agentId: string
  status?: SteelAgentRun['status']
  triggerType?: SteelAgentRun['triggerType']
  createdAt?: Date
  isTest?: boolean
  versionId?: string | null
  rounds?: number
}) {
  return prisma.steelAgentRun.create({
    data: { triggerType: 'MANUAL', ...data },
  })
}
