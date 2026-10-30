import type {
  AiPendingAction,
  Prisma,
  SteelAgent,
  SteelAgentAssignment,
  SteelAgentAssignmentEntity,
  SteelAgentRun,
  SteelAgentRunStatus,
  SteelAgentRunStep,
  SteelAgentRunStepKind,
  SteelAgentRunStepStatus,
  SteelAgentToolMode,
  SteelAgentTriggerType,
} from '@prisma/client'
import {
  steelAgentNotFound,
  steelAgentRunNotFound,
} from '@/src/errors/app-error'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

const AGENT_INCLUDE = {
  tools: { orderBy: { toolName: 'asc' } },
  owner: { select: { id: true, name: true, email: true, image: true } },
  runs: {
    // Test runs ("Testar agente") never show as the agent's last run.
    where: { isTest: false },
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: {
      id: true,
      status: true,
      triggerType: true,
      createdAt: true,
      finishedAt: true,
    },
  },
} satisfies Prisma.SteelAgentInclude

export type SteelAgentWithRelations = Prisma.SteelAgentGetPayload<{
  include: typeof AGENT_INCLUDE
}>

export type SteelAgentWithTools = Prisma.SteelAgentGetPayload<{
  include: { tools: true }
}>

export type SteelAgentRunWithAgent = SteelAgentRun & {
  agent: SteelAgentWithTools
}

export type SteelAgentRunDetail = SteelAgentRun & {
  agent: Pick<SteelAgent, 'id' | 'name' | 'ownerId'>
  steps: SteelAgentRunStep[]
  pendingActions: AiPendingAction[]
}

export interface SteelAgentToolInput {
  toolName: string
  mode: SteelAgentToolMode
}

export interface SteelAgentWriteInput {
  name: string
  description: string | null
  instructions: string
  triggerType: SteelAgentTriggerType
  cron: string | null
  timezone: string
  eventKey: string | null
  enabled: boolean
  ownerId: string
  maxToolRounds: number
  monthlyRunCap: number | null
  nextRunAt: Date | null
  /** A2: eval set that gates new versions (null = none). */
  evalSetId?: string | null
  evalMinPassRate?: number
  /** A2+A3: also gate versions on the saved simulation scenarios. */
  simGateEnabled?: boolean
  simGateMinPassRate?: number
}

/** Steel Agents and their allowed tools. */
export const SteelAgentRepository = {
  async listByWorkspace(
    workspaceId: string,
  ): Promise<Result<SteelAgentWithRelations[]>> {
    try {
      const agents = await prisma.steelAgent.findMany({
        where: { workspaceId },
        include: AGENT_INCLUDE,
        orderBy: { createdAt: 'desc' },
      })
      return ok(agents)
    } catch (error) {
      return err(dbError('Failed to list steel agents', error))
    }
  },

  async findById(
    id: string,
    workspaceId: string,
  ): Promise<Result<SteelAgentWithRelations>> {
    try {
      const agent = await prisma.steelAgent.findFirst({
        where: { id, workspaceId },
        include: AGENT_INCLUDE,
      })
      if (!agent) return err(steelAgentNotFound())
      return ok(agent)
    } catch (error) {
      return err(dbError('Failed to find steel agent', error))
    }
  },

  async create(
    data: SteelAgentWriteInput & {
      workspaceId: string
      createdById: string
      tools: SteelAgentToolInput[]
    },
  ): Promise<Result<SteelAgentWithRelations>> {
    const { tools, ...fields } = data
    try {
      const agent = await prisma.steelAgent.create({
        data: { ...fields, tools: { create: tools } },
        include: AGENT_INCLUDE,
      })
      return ok(agent)
    } catch (error) {
      return err(dbError('Failed to create steel agent', error))
    }
  },

  /** Updates fields and, when `tools` is given, replaces the whole list. */
  async update(
    id: string,
    data: Partial<SteelAgentWriteInput>,
    tools?: SteelAgentToolInput[],
  ): Promise<Result<SteelAgentWithRelations>> {
    try {
      const agent = await prisma.$transaction(async (tx) => {
        if (tools) {
          await tx.steelAgentTool.deleteMany({ where: { agentId: id } })
          if (tools.length > 0) {
            await tx.steelAgentTool.createMany({
              data: tools.map((tool) => ({ ...tool, agentId: id })),
            })
          }
        }
        return tx.steelAgent.update({
          where: { id },
          data,
          include: AGENT_INCLUDE,
        })
      })
      return ok(agent)
    } catch (error) {
      return err(dbError('Failed to update steel agent', error))
    }
  },

  async delete(id: string): Promise<Result<true>> {
    try {
      await prisma.steelAgent.delete({ where: { id } })
      return ok(true)
    } catch (error) {
      return err(dbError('Failed to delete steel agent', error))
    }
  },

  /** Enabled SCHEDULE agents of every workspace (worker tick). */
  async listScheduled(): Promise<Result<SteelAgent[]>> {
    try {
      const agents = await prisma.steelAgent.findMany({
        where: { triggerType: 'SCHEDULE', enabled: true, cron: { not: null } },
      })
      return ok(agents)
    } catch (error) {
      return err(dbError('Failed to list scheduled steel agents', error))
    }
  },

  /** Enabled agents of the workspace among `ids` (mentions, assignment). */
  async listEnabledByIds(
    workspaceId: string,
    ids: string[],
  ): Promise<Result<SteelAgent[]>> {
    if (ids.length === 0) return ok([])
    try {
      const agents = await prisma.steelAgent.findMany({
        where: { workspaceId, enabled: true, id: { in: ids } },
      })
      return ok(agents)
    } catch (error) {
      return err(dbError('Failed to list steel agents by id', error))
    }
  },

  /** Enabled EVENT agents of a workspace listening to `eventKey`. */
  async listByEvent(
    workspaceId: string,
    eventKey: string,
  ): Promise<Result<SteelAgent[]>> {
    try {
      const agents = await prisma.steelAgent.findMany({
        where: { workspaceId, triggerType: 'EVENT', enabled: true, eventKey },
      })
      return ok(agents)
    } catch (error) {
      return err(dbError('Failed to list event steel agents', error))
    }
  },

  /**
   * Claims a cron occurrence: only one tick wins (`lastRunAt` older than the
   * occurrence, or empty). Returns whether this caller won.
   */
  async claimOccurrence(
    id: string,
    occurrence: Date,
    nextRunAt: Date | null,
  ): Promise<Result<boolean>> {
    try {
      const { count } = await prisma.steelAgent.updateMany({
        where: {
          id,
          OR: [{ lastRunAt: null }, { lastRunAt: { lt: occurrence } }],
        },
        data: { lastRunAt: occurrence, nextRunAt },
      })
      return ok(count === 1)
    } catch (error) {
      return err(dbError('Failed to claim steel agent occurrence', error))
    }
  },
}

/** Executions of an agent. */
export const SteelAgentRunRepository = {
  async create(data: {
    workspaceId: string
    agentId: string
    triggerType: SteelAgentTriggerType
    triggerPayload?: Prisma.InputJsonValue
    startedById?: string | null
    status?: SteelAgentRunStatus
    summary?: string | null
    finishedAt?: Date | null
    /** "Testar agente": writes simulated, no approvals. */
    isTest?: boolean
    /** Run this test re-executes (A4). */
    rerunOfId?: string | null
  }): Promise<Result<SteelAgentRun>> {
    try {
      const run = await prisma.steelAgentRun.create({ data })
      return ok(run)
    } catch (error) {
      return err(dbError('Failed to create steel agent run', error))
    }
  },

  async findDetail(
    id: string,
    workspaceId: string,
  ): Promise<Result<SteelAgentRunDetail>> {
    try {
      const run = await prisma.steelAgentRun.findFirst({
        where: { id, workspaceId },
        include: {
          agent: { select: { id: true, name: true, ownerId: true } },
          steps: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
          pendingActions: { orderBy: { createdAt: 'asc' } },
        },
      })
      if (!run) return err(steelAgentRunNotFound())
      return ok(run)
    } catch (error) {
      return err(dbError('Failed to find steel agent run', error))
    }
  },

  /** Run + agent + tools, unscoped (worker side). */
  async findForExecution(id: string): Promise<Result<SteelAgentRunWithAgent>> {
    try {
      const run = await prisma.steelAgentRun.findUnique({
        where: { id },
        include: { agent: { include: { tools: true } } },
      })
      if (!run) return err(steelAgentRunNotFound())
      return ok(run)
    } catch (error) {
      return err(dbError('Failed to load steel agent run', error))
    }
  },

  async listByAgent(
    agentId: string,
    filter: { limit: number; status?: SteelAgentRunStatus },
  ): Promise<Result<SteelAgentRun[]>> {
    try {
      const runs = await prisma.steelAgentRun.findMany({
        where: {
          agentId,
          ...(filter.status ? { status: filter.status } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: filter.limit,
      })
      return ok(runs)
    } catch (error) {
      return err(dbError('Failed to list steel agent runs', error))
    }
  },

  /**
   * Conditional status change: only succeeds while the run is in one of
   * `from` (one runner wins; a duplicated job becomes a no-op).
   */
  async claim(
    id: string,
    from: SteelAgentRunStatus[],
    data: Prisma.SteelAgentRunUpdateManyMutationInput,
  ): Promise<Result<boolean>> {
    try {
      const { count } = await prisma.steelAgentRun.updateMany({
        where: { id, status: { in: from } },
        data,
      })
      return ok(count === 1)
    } catch (error) {
      return err(dbError('Failed to claim steel agent run', error))
    }
  },

  async update(
    id: string,
    data: Prisma.SteelAgentRunUpdateInput,
  ): Promise<Result<SteelAgentRun>> {
    try {
      const run = await prisma.steelAgentRun.update({ where: { id }, data })
      return ok(run)
    } catch (error) {
      return err(dbError('Failed to update steel agent run', error))
    }
  },

  /** Runs that count against the monthly cap (SKIPPED and test ones do not). */
  async countSince(agentId: string, since: Date): Promise<Result<number>> {
    try {
      const count = await prisma.steelAgentRun.count({
        where: {
          agentId,
          createdAt: { gte: since },
          status: { not: 'SKIPPED' },
          isTest: false,
        },
      })
      return ok(count)
    } catch (error) {
      return err(dbError('Failed to count steel agent runs', error))
    }
  },

  /** Every action proposed by a run, oldest first. */
  async listActions(runId: string): Promise<Result<AiPendingAction[]>> {
    try {
      const actions = await prisma.aiPendingAction.findMany({
        where: { agentRunId: runId },
        orderBy: { createdAt: 'asc' },
      })
      return ok(actions)
    } catch (error) {
      return err(dbError('Failed to list steel agent run actions', error))
    }
  },

  /** Agent actions still PENDING past their expiry (worker tick). */
  async listOverdueActions(now: Date): Promise<Result<AiPendingAction[]>> {
    try {
      const actions = await prisma.aiPendingAction.findMany({
        where: {
          agentRunId: { not: null },
          status: 'PENDING',
          expiresAt: { lt: now },
        },
        take: 500,
      })
      return ok(actions)
    } catch (error) {
      return err(dbError('Failed to list overdue agent actions', error))
    }
  },
}

/** Timeline of a run. */
export const SteelAgentRunStepRepository = {
  async create(data: {
    runId: string
    kind: SteelAgentRunStepKind
    status: SteelAgentRunStepStatus
    toolName?: string | null
    toolCallId?: string | null
    pendingActionId?: string | null
    input?: Prisma.InputJsonValue
    output?: Prisma.InputJsonValue
    error?: string | null
  }): Promise<Result<SteelAgentRunStep>> {
    try {
      const step = await prisma.steelAgentRunStep.create({ data })
      return ok(step)
    } catch (error) {
      return err(dbError('Failed to create steel agent run step', error))
    }
  },

  /** Records the decision on the APPROVAL step of a pending action. */
  async updateByPendingAction(
    pendingActionId: string,
    data: {
      status: SteelAgentRunStepStatus
      output?: Prisma.InputJsonValue
      error?: string | null
    },
  ): Promise<Result<number>> {
    try {
      const { count } = await prisma.steelAgentRunStep.updateMany({
        where: { pendingActionId, kind: 'APPROVAL' },
        data,
      })
      return ok(count)
    } catch (error) {
      return err(dbError('Failed to update steel agent approval step', error))
    }
  },
}

/** Tickets and leads handed to a Steel Agent (one agent per record). */
export const SteelAgentAssignmentRepository = {
  async find(
    entityType: SteelAgentAssignmentEntity,
    entityId: string,
    workspaceId: string,
  ): Promise<Result<SteelAgentAssignment | null>> {
    try {
      const row = await prisma.steelAgentAssignment.findFirst({
        where: { entityType, entityId, workspaceId },
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to find steel agent assignment', error))
    }
  },

  /** Hands the record to `agentId`; re-assigning replaces the previous one. */
  async upsert(data: {
    workspaceId: string
    agentId: string
    entityType: SteelAgentAssignmentEntity
    entityId: string
    assignedById: string | null
  }): Promise<Result<SteelAgentAssignment>> {
    try {
      const row = await prisma.steelAgentAssignment.upsert({
        where: {
          entityType_entityId: {
            entityType: data.entityType,
            entityId: data.entityId,
          },
        },
        create: data,
        update: {
          agentId: data.agentId,
          assignedById: data.assignedById,
          createdAt: new Date(),
        },
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to assign steel agent', error))
    }
  },

  async remove(
    entityType: SteelAgentAssignmentEntity,
    entityId: string,
    workspaceId: string,
  ): Promise<Result<number>> {
    try {
      const { count } = await prisma.steelAgentAssignment.deleteMany({
        where: { entityType, entityId, workspaceId },
      })
      return ok(count)
    } catch (error) {
      return err(dbError('Failed to unassign steel agent', error))
    }
  },
}
