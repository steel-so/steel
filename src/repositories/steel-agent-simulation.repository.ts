import type {
  Prisma,
  SteelAgent,
  SteelAgentSimulation,
  SteelAgentSimulationCase,
  SteelAgentSimulationStatus,
} from '@prisma/client'
import { steelAgentSimulationNotFound } from '@/src/errors/app-error'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'
import type { SteelAgentWithTools } from './steel-agent.repository'

export type SteelAgentSimulationWithCases = SteelAgentSimulation & {
  cases: SteelAgentSimulationCase[]
}

export type SteelAgentSimulationDetail = SteelAgentSimulationWithCases & {
  agent: Pick<SteelAgent, 'id' | 'name' | 'ownerId'>
}

export type SteelAgentSimulationForExecution = SteelAgentSimulationWithCases & {
  agent: SteelAgentWithTools
}

export interface SteelAgentSimulationCaseInput {
  label: string
  personaKey: string | null
  persona: string
  scenario: string
  channel: string
  openingMessage: string
  criteria: string[]
  maxTurns: number
}

/** A simulation silent for this long is considered dead. */
export const STALE_AFTER_MS = 30 * 60_000

const CASES_ORDER = { orderBy: { position: 'asc' } } as const

export const ACTIVE_SIMULATION_STATUSES: SteelAgentSimulationStatus[] = [
  'QUEUED',
  'RUNNING',
]

export const SteelAgentSimulationRepository = {
  /** Creates the simulation and all its cases atomically. */
  async create(data: {
    workspaceId: string
    agentId: string
    name: string
    startedById: string
    passScore: number
    cases: SteelAgentSimulationCaseInput[]
  }): Promise<Result<SteelAgentSimulationWithCases>> {
    try {
      const { cases, ...fields } = data
      const simulation = await prisma.steelAgentSimulation.create({
        data: {
          ...fields,
          totalCases: cases.length,
          cases: {
            create: cases.map((item, position) => ({
              ...item,
              position,
              criteria: item.criteria as Prisma.InputJsonValue,
            })),
          },
        },
        include: { cases: CASES_ORDER },
      })
      return ok(simulation)
    } catch (error) {
      return err(dbError('Failed to create steel agent simulation', error))
    }
  },

  async findDetail(
    id: string,
    workspaceId: string,
  ): Promise<Result<SteelAgentSimulationDetail>> {
    try {
      const simulation = await prisma.steelAgentSimulation.findFirst({
        where: { id, workspaceId },
        include: {
          cases: CASES_ORDER,
          agent: { select: { id: true, name: true, ownerId: true } },
        },
      })
      if (!simulation) return err(steelAgentSimulationNotFound())
      return ok(simulation)
    } catch (error) {
      return err(dbError('Failed to find steel agent simulation', error))
    }
  },

  /** Simulation + cases + agent with its tools, unscoped (worker side). */
  async findForExecution(
    id: string,
  ): Promise<Result<SteelAgentSimulationForExecution>> {
    try {
      const simulation = await prisma.steelAgentSimulation.findUnique({
        where: { id },
        include: {
          cases: CASES_ORDER,
          agent: { include: { tools: true } },
        },
      })
      if (!simulation) return err(steelAgentSimulationNotFound())
      return ok(simulation)
    } catch (error) {
      return err(dbError('Failed to load steel agent simulation', error))
    }
  },

  async listByAgent(
    agentId: string,
    limit: number,
  ): Promise<Result<SteelAgentSimulation[]>> {
    try {
      const simulations = await prisma.steelAgentSimulation.findMany({
        where: { agentId },
        orderBy: { createdAt: 'desc' },
        take: limit,
      })
      return ok(simulations)
    } catch (error) {
      return err(dbError('Failed to list steel agent simulations', error))
    }
  },

  /**
   * Whether the agent has a simulation still queued or running. One that has
   * not moved for `STALE_AFTER_MS` (worker crash) no longer blocks a new run.
   */
  async hasActive(agentId: string, now = new Date()): Promise<Result<boolean>> {
    try {
      const count = await prisma.steelAgentSimulation.count({
        where: {
          agentId,
          status: { in: ACTIVE_SIMULATION_STATUSES },
          updatedAt: { gte: new Date(now.getTime() - STALE_AFTER_MS) },
        },
      })
      return ok(count > 0)
    } catch (error) {
      return err(dbError('Failed to check active simulations', error))
    }
  },

  /** Moves the simulation out of `from`; true when this caller won. */
  async claim(
    id: string,
    from: SteelAgentSimulationStatus[],
    data: Prisma.SteelAgentSimulationUpdateManyMutationInput,
  ): Promise<Result<boolean>> {
    try {
      const { count } = await prisma.steelAgentSimulation.updateMany({
        where: { id, status: { in: from } },
        data,
      })
      return ok(count === 1)
    } catch (error) {
      return err(dbError('Failed to claim steel agent simulation', error))
    }
  },

  async update(
    id: string,
    data: Prisma.SteelAgentSimulationUpdateInput,
  ): Promise<Result<SteelAgentSimulation>> {
    try {
      const simulation = await prisma.steelAgentSimulation.update({
        where: { id },
        data,
      })
      return ok(simulation)
    } catch (error) {
      return err(dbError('Failed to update steel agent simulation', error))
    }
  },

  async delete(id: string): Promise<Result<true>> {
    try {
      await prisma.steelAgentSimulation.delete({ where: { id } })
      return ok(true)
    } catch (error) {
      return err(dbError('Failed to delete steel agent simulation', error))
    }
  },
}

export const SteelAgentSimulationCaseRepository = {
  async update(
    id: string,
    data: Prisma.SteelAgentSimulationCaseUpdateInput,
  ): Promise<Result<SteelAgentSimulationCase>> {
    try {
      const item = await prisma.steelAgentSimulationCase.update({
        where: { id },
        data,
      })
      return ok(item)
    } catch (error) {
      return err(dbError('Failed to update steel agent simulation case', error))
    }
  },

  /** Cases the worker left unfinished (crash/skip) become FAILED. */
  async failUnfinished(
    simulationId: string,
    error: string,
  ): Promise<Result<number>> {
    try {
      const { count } = await prisma.steelAgentSimulationCase.updateMany({
        where: {
          simulationId,
          status: { in: ['QUEUED', 'RUNNING'] },
        },
        data: { status: 'FAILED', error, finishedAt: new Date() },
      })
      return ok(count)
    } catch (cause) {
      return err(dbError('Failed to fail unfinished simulation cases', cause))
    }
  },
}
