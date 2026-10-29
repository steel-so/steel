import type {
  AiEvalCase,
  AiEvalResult,
  AiEvalRun,
  AiEvalRunStatus,
  AiEvalSet,
  AiEvalTarget,
  ModuleKind,
  Prisma,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

const RUN_INCLUDE = {
  startedBy: { select: { id: true, name: true } },
} as const

export type AiEvalRunWithUser = Prisma.AiEvalRunGetPayload<{
  include: typeof RUN_INCLUDE
}>

export type AiEvalRunWithResults = AiEvalRunWithUser & {
  results: AiEvalResult[]
}

export type AiEvalSetSummary = AiEvalSet & {
  caseCount: number
  lastRun: AiEvalRunWithUser | null
}

export type AiEvalSetWithCases = AiEvalSetSummary & { cases: AiEvalCase[] }

/** A run claimed by the worker, with what it needs to execute. */
export type AiEvalClaimedRun = AiEvalRun & {
  set: AiEvalSet & { cases: AiEvalCase[] }
}

export interface AiEvalCaseData {
  input: string
  expected: string | null
  criteria: string | null
  mustContain: string[]
  mustNotContain: string[]
  sourceMessageId?: string | null
}

export interface AiEvalResultData {
  caseId: string | null
  input: string
  output: string
  passed: boolean
  checksPassed: boolean
  failedChecks: string[]
  judgeScore: number | null
  judgePassed: boolean | null
  judgeRationale: string | null
  inputTokens: number
  outputTokens: number
  costUsd: number
  error: string | null
}

export interface AiEvalSourceTurn {
  /** The user message right before the assistant answer. */
  question: string | null
  answer: string
  conversationUserId: string
}

const ACTIVE: AiEvalRunStatus[] = ['QUEUED', 'RUNNING']

const SET_INCLUDE = {
  _count: { select: { cases: true } },
  runs: {
    orderBy: { createdAt: 'desc' },
    take: 1,
    include: RUN_INCLUDE,
  },
} satisfies Prisma.AiEvalSetInclude

type SetRow = Prisma.AiEvalSetGetPayload<{ include: typeof SET_INCLUDE }>

function toSummary(row: SetRow): AiEvalSetSummary {
  const { _count, runs, ...set } = row
  return { ...set, caseCount: _count.cases, lastRun: runs[0] ?? null }
}

/** Eval sets, cases, runs and results (`ai_eval_*`). No access rules here. */
export const AiEvalRepository = {
  async countSets(workspaceId: string): Promise<Result<number>> {
    try {
      return ok(await prisma.aiEvalSet.count({ where: { workspaceId } }))
    } catch (error) {
      return err(dbError('Failed to count eval sets', error))
    }
  },

  async listSets(
    workspaceId: string,
    target?: AiEvalTarget,
  ): Promise<Result<AiEvalSetSummary[]>> {
    try {
      const rows = await prisma.aiEvalSet.findMany({
        where: { workspaceId, ...(target ? { target } : {}) },
        orderBy: { createdAt: 'asc' },
        include: SET_INCLUDE,
      })
      return ok(rows.map(toSummary))
    } catch (error) {
      return err(dbError('Failed to list eval sets', error))
    }
  },

  async findSet(
    id: string,
    workspaceId: string,
  ): Promise<Result<AiEvalSetWithCases | null>> {
    try {
      const row = await prisma.aiEvalSet.findFirst({
        where: { id, workspaceId },
        include: {
          ...SET_INCLUDE,
          cases: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] },
        },
      })
      if (!row) return ok(null)
      const { cases, ...rest } = row
      return ok({ ...toSummary(rest), cases })
    } catch (error) {
      return err(dbError('Failed to find eval set', error))
    }
  },

  async createSet(data: {
    workspaceId: string
    name: string
    description: string | null
    target: AiEvalTarget
    skillId: string | null
    createdById: string
  }): Promise<Result<AiEvalSetSummary>> {
    try {
      const row = await prisma.aiEvalSet.create({
        data,
        include: SET_INCLUDE,
      })
      return ok(toSummary(row))
    } catch (error) {
      return err(dbError('Failed to create eval set', error))
    }
  },

  async updateSet(
    id: string,
    data: Prisma.AiEvalSetUpdateInput,
  ): Promise<Result<AiEvalSetSummary>> {
    try {
      const row = await prisma.aiEvalSet.update({
        where: { id },
        data,
        include: SET_INCLUDE,
      })
      return ok(toSummary(row))
    } catch (error) {
      return err(dbError('Failed to update eval set', error))
    }
  },

  async deleteSet(id: string): Promise<Result<void>> {
    try {
      await prisma.aiEvalSet.deleteMany({ where: { id } })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to delete eval set', error))
    }
  },

  async countCases(setId: string): Promise<Result<number>> {
    try {
      return ok(await prisma.aiEvalCase.count({ where: { setId } }))
    } catch (error) {
      return err(dbError('Failed to count eval cases', error))
    }
  },

  /** Appends a case at the end of the set. */
  async createCase(
    setId: string,
    data: AiEvalCaseData,
  ): Promise<Result<AiEvalCase>> {
    try {
      const last = await prisma.aiEvalCase.aggregate({
        where: { setId },
        _max: { position: true },
      })
      const row = await prisma.aiEvalCase.create({
        data: {
          setId,
          ...data,
          position: (last._max.position ?? -1) + 1,
        },
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to create eval case', error))
    }
  },

  async findCase(
    caseId: string,
    setId: string,
  ): Promise<Result<AiEvalCase | null>> {
    try {
      return ok(
        await prisma.aiEvalCase.findFirst({ where: { id: caseId, setId } }),
      )
    } catch (error) {
      return err(dbError('Failed to find eval case', error))
    }
  },

  async updateCase(
    caseId: string,
    data: Partial<AiEvalCaseData>,
  ): Promise<Result<AiEvalCase>> {
    try {
      return ok(await prisma.aiEvalCase.update({ where: { id: caseId }, data }))
    } catch (error) {
      return err(dbError('Failed to update eval case', error))
    }
  },

  async deleteCase(caseId: string): Promise<Result<void>> {
    try {
      await prisma.aiEvalCase.deleteMany({ where: { id: caseId } })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to delete eval case', error))
    }
  },

  async findActiveRun(setId: string): Promise<Result<AiEvalRun | null>> {
    try {
      return ok(
        await prisma.aiEvalRun.findFirst({
          where: { setId, status: { in: ACTIVE } },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find active eval run', error))
    }
  },

  async createRun(data: {
    workspaceId: string
    setId: string
    modelKey: string | null
    skillId: string | null
    promptOverride: string | null
    reason: string
    startedById: string
    caseCount: number
    /** Steel Agent version under evaluation (A2 gate). */
    agentVersionId?: string | null
  }): Promise<Result<AiEvalRunWithUser>> {
    try {
      return ok(await prisma.aiEvalRun.create({ data, include: RUN_INCLUDE }))
    } catch (error) {
      return err(dbError('Failed to create eval run', error))
    }
  },

  async listRuns(
    setId: string,
    take: number,
  ): Promise<Result<AiEvalRunWithUser[]>> {
    try {
      return ok(
        await prisma.aiEvalRun.findMany({
          where: { setId },
          orderBy: { createdAt: 'desc' },
          take,
          include: RUN_INCLUDE,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list eval runs', error))
    }
  },

  async findRun(
    runId: string,
    workspaceId: string,
  ): Promise<Result<AiEvalRunWithResults | null>> {
    try {
      return ok(
        await prisma.aiEvalRun.findFirst({
          where: { id: runId, workspaceId },
          include: {
            ...RUN_INCLUDE,
            results: { orderBy: { createdAt: 'asc' } },
          },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find eval run', error))
    }
  },

  /**
   * QUEUED → RUNNING, atomically (a duplicate job finds nothing to claim).
   * Returns the run with its set and the cases as they are now.
   */
  async claimRun(
    runId: string,
    now: Date,
  ): Promise<Result<AiEvalClaimedRun | null>> {
    try {
      const claimed = await prisma.aiEvalRun.updateMany({
        where: { id: runId, status: 'QUEUED' },
        data: { status: 'RUNNING', startedAt: now },
      })
      if (claimed.count === 0) return ok(null)
      const run = await prisma.aiEvalRun.findUnique({
        where: { id: runId },
        include: {
          set: {
            include: {
              cases: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] },
            },
          },
        },
      })
      return ok(run)
    } catch (error) {
      return err(dbError('Failed to claim eval run', error))
    }
  },

  async addResult(
    runId: string,
    data: AiEvalResultData,
  ): Promise<Result<AiEvalResult>> {
    try {
      return ok(await prisma.aiEvalResult.create({ data: { runId, ...data } }))
    } catch (error) {
      return err(dbError('Failed to save eval result', error))
    }
  },

  async finishRun(
    runId: string,
    data: {
      status: Extract<AiEvalRunStatus, 'DONE' | 'FAILED'>
      modelKey: string | null
      judgeModelKey: string | null
      caseCount: number
      passedCount: number
      failedCount: number
      avgScore: number | null
      costUsd: number
      error: string | null
      finishedAt: Date
    },
  ): Promise<Result<AiEvalRun>> {
    try {
      return ok(await prisma.aiEvalRun.update({ where: { id: runId }, data }))
    } catch (error) {
      return err(dbError('Failed to finish eval run', error))
    }
  },

  /** Last finished (DONE) run of every set of a target. */
  async latestDoneByTarget(
    workspaceId: string,
    target: AiEvalTarget,
  ): Promise<
    Result<
      { set: AiEvalSet; caseCount: number; run: AiEvalRunWithUser | null }[]
    >
  > {
    try {
      const rows = await prisma.aiEvalSet.findMany({
        where: { workspaceId, target },
        orderBy: { createdAt: 'asc' },
        include: {
          _count: { select: { cases: true } },
          runs: {
            where: { status: 'DONE' },
            orderBy: { createdAt: 'desc' },
            take: 1,
            include: RUN_INCLUDE,
          },
        },
      })
      return ok(
        rows.map(({ _count, runs, ...set }) => ({
          set,
          caseCount: _count.cases,
          run: runs[0] ?? null,
        })),
      )
    } catch (error) {
      return err(dbError('Failed to find the latest eval runs', error))
    }
  },

  /** Name, enabled modules and AI settings the runner builds prompts with. */
  async findRunContext(workspaceId: string): Promise<
    Result<{
      name: string
      modules: ModuleKind[]
      aiEnabled: boolean
      whatsappPrompt: string | null
    } | null>
  > {
    try {
      const row = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: {
          name: true,
          moduleAccess: { where: { enabled: true }, select: { module: true } },
          aiSettings: { select: { aiEnabled: true } },
          whatsappAiConfig: { select: { systemPrompt: true } },
        },
      })
      if (!row) return ok(null)
      return ok({
        name: row.name,
        modules: row.moduleAccess.map((access) => access.module),
        aiEnabled: row.aiSettings?.aiEnabled ?? true,
        whatsappPrompt: row.whatsappAiConfig?.systemPrompt ?? null,
      })
    } catch (error) {
      return err(dbError('Failed to load the eval run context', error))
    }
  },

  /** An assistant message and the user question right before it. */
  async findSourceTurn(
    messageId: string,
    workspaceId: string,
  ): Promise<Result<AiEvalSourceTurn | null>> {
    try {
      const message = await prisma.aiMessage.findFirst({
        where: {
          id: messageId,
          role: 'ASSISTANT',
          conversation: { workspaceId, deletedAt: null },
        },
        select: {
          content: true,
          createdAt: true,
          conversationId: true,
          conversation: { select: { userId: true } },
        },
      })
      if (!message) return ok(null)
      const question = await prisma.aiMessage.findFirst({
        where: {
          conversationId: message.conversationId,
          role: 'USER',
          createdAt: { lte: message.createdAt },
        },
        orderBy: { createdAt: 'desc' },
        select: { content: true },
      })
      return ok({
        question: question?.content ?? null,
        answer: message.content,
        conversationUserId: message.conversation.userId,
      })
    } catch (error) {
      return err(dbError('Failed to find the source chat turn', error))
    }
  },
}
