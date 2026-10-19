import type { Prisma, WorkspaceAiGuardrails } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

export const WorkspaceAiGuardrailsRepository = {
  async findByWorkspace(
    workspaceId: string,
  ): Promise<Result<WorkspaceAiGuardrails | null>> {
    try {
      const row = await prisma.workspaceAiGuardrails.findUnique({
        where: { workspaceId },
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to find workspace AI guardrails', error))
    }
  },

  async upsert(
    workspaceId: string,
    data: Omit<Prisma.WorkspaceAiGuardrailsUncheckedCreateInput, 'workspaceId'>,
  ): Promise<Result<WorkspaceAiGuardrails>> {
    try {
      const row = await prisma.workspaceAiGuardrails.upsert({
        where: { workspaceId },
        create: { workspaceId, ...data },
        update: data,
      })
      return ok(row)
    } catch (error) {
      return err(dbError('Failed to upsert workspace AI guardrails', error))
    }
  },
}
