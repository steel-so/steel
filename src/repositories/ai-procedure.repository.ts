import type {
  AiProcedure,
  AiProcedureStatus,
  AiProcedureVersion,
  Prisma,
} from '@prisma/client'
import { aiProcedureNotFound } from '@/src/errors/app-error'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

export interface AiProcedureDefinitionInput {
  name: string
  description: string | null
  whenToUse: string
  steps: Prisma.InputJsonValue
  maxAttempts: number
  handoffMessage: string | null
  whatsappEnabled: boolean
  agentIds: string[]
  ownerId: string | null
  status: AiProcedureStatus
}

/** Procedures and their version history. No access rules here. */
export const AiProcedureRepository = {
  async list(workspaceId: string): Promise<Result<AiProcedure[]>> {
    try {
      return ok(
        await prisma.aiProcedure.findMany({
          where: { workspaceId },
          orderBy: { updatedAt: 'desc' },
        }),
      )
    } catch (cause) {
      return err(dbError('Falha ao listar procedimentos', cause))
    }
  },

  async count(workspaceId: string): Promise<Result<number>> {
    try {
      return ok(await prisma.aiProcedure.count({ where: { workspaceId } }))
    } catch (cause) {
      return err(dbError('Falha ao contar procedimentos', cause))
    }
  },

  async findById(
    id: string,
    workspaceId: string,
  ): Promise<Result<AiProcedure>> {
    try {
      const found = await prisma.aiProcedure.findFirst({
        where: { id, workspaceId },
      })
      return found ? ok(found) : err(aiProcedureNotFound())
    } catch (cause) {
      return err(dbError('Falha ao buscar procedimento', cause))
    }
  },

  /** Active procedures that may serve a channel. */
  async listActive(
    workspaceId: string,
    filter: { whatsapp?: boolean; agentId?: string },
  ): Promise<Result<AiProcedure[]>> {
    try {
      return ok(
        await prisma.aiProcedure.findMany({
          where: {
            workspaceId,
            status: 'ACTIVE',
            ...(filter.whatsapp && { whatsappEnabled: true }),
            ...(filter.agentId && { agentIds: { has: filter.agentId } }),
          },
          orderBy: { name: 'asc' },
        }),
      )
    } catch (cause) {
      return err(dbError('Falha ao listar procedimentos ativos', cause))
    }
  },

  /** Creates the procedure and its version 1 in one transaction. */
  async create(
    workspaceId: string,
    createdById: string,
    data: AiProcedureDefinitionInput,
  ): Promise<Result<AiProcedure>> {
    try {
      const created = await prisma.$transaction(async (tx) => {
        const procedure = await tx.aiProcedure.create({
          data: { ...data, workspaceId, createdById, currentVersion: 1 },
        })
        await tx.aiProcedureVersion.create({
          data: {
            workspaceId,
            procedureId: procedure.id,
            number: 1,
            whenToUse: data.whenToUse,
            steps: data.steps,
            maxAttempts: data.maxAttempts,
            handoffMessage: data.handoffMessage,
            changeNote: 'Criação',
            createdById,
          },
        })
        return procedure
      })
      return ok(created)
    } catch (cause) {
      return err(dbError('Falha ao criar procedimento', cause))
    }
  },

  /**
   * Updates the columns; with `version`, also appends the next numbered
   * snapshot (number = max + 1) and moves `currentVersion` to it.
   */
  async update(
    id: string,
    workspaceId: string,
    data: Partial<AiProcedureDefinitionInput>,
    version?: { changeNote: string | null; createdById: string },
  ): Promise<Result<AiProcedure>> {
    try {
      const updated = await prisma.$transaction(async (tx) => {
        const current = await tx.aiProcedure.findFirst({
          where: { id, workspaceId },
        })
        if (!current) return null
        let currentVersion = current.currentVersion
        if (version) {
          const last = await tx.aiProcedureVersion.aggregate({
            where: { procedureId: id },
            _max: { number: true },
          })
          currentVersion = (last._max.number ?? 0) + 1
        }
        const saved = await tx.aiProcedure.update({
          where: { id },
          data: { ...data, currentVersion },
        })
        if (version) {
          await tx.aiProcedureVersion.create({
            data: {
              workspaceId,
              procedureId: id,
              number: currentVersion,
              whenToUse: saved.whenToUse,
              steps: saved.steps as Prisma.InputJsonValue,
              maxAttempts: saved.maxAttempts,
              handoffMessage: saved.handoffMessage,
              changeNote: version.changeNote,
              createdById: version.createdById,
            },
          })
        }
        return saved
      })
      return updated ? ok(updated) : err(aiProcedureNotFound())
    } catch (cause) {
      return err(dbError('Falha ao atualizar procedimento', cause))
    }
  },

  async delete(id: string, workspaceId: string): Promise<Result<AiProcedure>> {
    try {
      const found = await prisma.aiProcedure.findFirst({
        where: { id, workspaceId },
      })
      if (!found) return err(aiProcedureNotFound())
      await prisma.aiProcedure.delete({ where: { id } })
      return ok(found)
    } catch (cause) {
      return err(dbError('Falha ao excluir procedimento', cause))
    }
  },

  async listVersions(
    procedureId: string,
  ): Promise<Result<AiProcedureVersion[]>> {
    try {
      return ok(
        await prisma.aiProcedureVersion.findMany({
          where: { procedureId },
          orderBy: { number: 'desc' },
        }),
      )
    } catch (cause) {
      return err(dbError('Falha ao listar versões', cause))
    }
  },

  async findVersion(
    procedureId: string,
    versionId: string,
  ): Promise<Result<AiProcedureVersion | null>> {
    try {
      return ok(
        await prisma.aiProcedureVersion.findFirst({
          where: { id: versionId, procedureId },
        }),
      )
    } catch (cause) {
      return err(dbError('Falha ao buscar versão', cause))
    }
  },

  /** The snapshot a run started with (runs keep the version they began on). */
  async findVersionByNumber(
    procedureId: string,
    number: number,
  ): Promise<Result<AiProcedureVersion | null>> {
    try {
      return ok(
        await prisma.aiProcedureVersion.findUnique({
          where: { procedureId_number: { procedureId, number } },
        }),
      )
    } catch (cause) {
      return err(dbError('Falha ao buscar versão', cause))
    }
  },
}
