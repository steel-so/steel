import { createId } from '@paralleldrive/cuid2'
import type { SteelAgentVersion } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'

const NOW = new Date('2026-10-29T12:00:00.000Z')

export function createFakeSteelAgentVersion(
  overrides?: Partial<SteelAgentVersion>,
): SteelAgentVersion {
  return {
    id: createId(),
    workspaceId: createId(),
    agentId: createId(),
    number: 1,
    status: 'PUBLISHED',
    instructions: 'Classifique cada chamado novo.',
    maxToolRounds: 8,
    tools: [{ toolName: 'sd_list_tickets', mode: 'APPROVAL' }],
    changeNote: null,
    rolloutPercent: null,
    evalRunId: null,
    evalPassed: null,
    evalTotal: null,
    evalNote: null,
    simulationId: null,
    simPassed: null,
    simTotal: null,
    createdById: null,
    publishedAt: NOW,
    resolvedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

export async function seedSteelAgentVersion(data: {
  workspaceId: string
  agentId: string
  number?: number
  status?: SteelAgentVersion['status']
  instructions?: string
  maxToolRounds?: number
  tools?: { toolName: string; mode: 'AUTO' | 'APPROVAL' }[]
  rolloutPercent?: number | null
}) {
  const { tools = [], ...fields } = data
  return prisma.steelAgentVersion.create({
    data: {
      number: 1,
      status: 'PUBLISHED',
      instructions: 'Faça a triagem.',
      maxToolRounds: 8,
      ...fields,
      tools,
    },
  })
}
