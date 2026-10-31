import type {
  AiProcedureRun,
  AiProcedureRunStatus,
  AiProcedureRunStep,
  AiProcedureRunSubject,
  Prisma,
} from '@prisma/client'
import { aiProcedureRunNotFound } from '@/src/errors/app-error'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

export interface AiProcedureRunStepInput {
  position: number
  stepKey: string
  kind: string
  title: string
  status: 'OK' | 'FAILED' | 'SKIPPED' | 'REJECTED'
  input?: Prisma.InputJsonValue
  output?: Prisma.InputJsonValue
  error?: string | null
}

export type AiProcedureRunWithName = AiProcedureRun & {
  procedure: { name: string }
}

/** Executions of procedures and their step trace. No access rules here. */
export const AiProcedureRunRepository = {
  async create(data: {
    workspaceId: string
    procedureId: string
    versionNumber: number
    subjectType: AiProcedureRunSubject
    subjectId: string
    state: Prisma.InputJsonValue
  }): Promise<Result<AiProcedureRun>> {
    try {
      return ok(await prisma.aiProcedureRun.create({ data }))
    } catch (cause) {
      return err(dbError('Falha ao iniciar procedimento', cause))
    }
  },

  async findActive(
    subjectType: AiProcedureRunSubject,
    subjectId: string,
  ): Promise<Result<AiProcedureRun | null>> {
    try {
      return ok(
        await prisma.aiProcedureRun.findFirst({
          where: { subjectType, subjectId, status: 'RUNNING' },
          orderBy: { startedAt: 'desc' },
        }),
      )
    } catch (cause) {
      return err(dbError('Falha ao buscar procedimento em andamento', cause))
    }
  },

  async save(
    id: string,
    data: {
      state: Prisma.InputJsonValue
      status?: AiProcedureRunStatus
      failureReason?: string | null
      finishedAt?: Date | null
    },
    steps: AiProcedureRunStepInput[] = [],
  ): Promise<Result<AiProcedureRun>> {
    try {
      const saved = await prisma.$transaction(async (tx) => {
        if (steps.length > 0) {
          await tx.aiProcedureRunStep.createMany({
            data: steps.map((step) => ({ ...step, runId: id })),
          })
        }
        return tx.aiProcedureRun.update({ where: { id }, data })
      })
      return ok(saved)
    } catch (cause) {
      return err(dbError('Falha ao salvar procedimento', cause))
    }
  },

  async countSteps(runId: string): Promise<Result<number>> {
    try {
      return ok(await prisma.aiProcedureRunStep.count({ where: { runId } }))
    } catch (cause) {
      return err(dbError('Falha ao contar passos', cause))
    }
  },

  async list(
    workspaceId: string,
    filter: {
      procedureId?: string
      status?: AiProcedureRunStatus
      limit: number
    },
  ): Promise<Result<AiProcedureRunWithName[]>> {
    try {
      return ok(
        await prisma.aiProcedureRun.findMany({
          where: {
            workspaceId,
            ...(filter.procedureId && { procedureId: filter.procedureId }),
            ...(filter.status && { status: filter.status }),
          },
          include: { procedure: { select: { name: true } } },
          orderBy: { startedAt: 'desc' },
          take: filter.limit,
        }),
      )
    } catch (cause) {
      return err(dbError('Falha ao listar execuções', cause))
    }
  },

  async findDetail(
    id: string,
    workspaceId: string,
  ): Promise<
    Result<AiProcedureRunWithName & { steps: AiProcedureRunStep[] }>
  > {
    try {
      const found = await prisma.aiProcedureRun.findFirst({
        where: { id, workspaceId },
        include: {
          procedure: { select: { name: true } },
          steps: { orderBy: { createdAt: 'asc' } },
        },
      })
      return found ? ok(found) : err(aiProcedureRunNotFound())
    } catch (cause) {
      return err(dbError('Falha ao buscar execução', cause))
    }
  },

  async countSince(
    procedureId: string,
    since: Date,
  ): Promise<Result<number>> {
    try {
      return ok(
        await prisma.aiProcedureRun.count({
          where: { procedureId, startedAt: { gte: since } },
        }),
      )
    } catch (cause) {
      return err(dbError('Falha ao contar execuções', cause))
    }
  },

  async countsSince(
    workspaceId: string,
    since: Date,
  ): Promise<Result<Record<string, number>>> {
    try {
      const rows = await prisma.aiProcedureRun.groupBy({
        by: ['procedureId'],
        where: { workspaceId, startedAt: { gte: since } },
        _count: { _all: true },
      })
      return ok(
        Object.fromEntries(rows.map((r) => [r.procedureId, r._count._all])),
      )
    } catch (cause) {
      return err(dbError('Falha ao contar execuções', cause))
    }
  },
}
