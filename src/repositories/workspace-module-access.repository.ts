import type { ModuleKind, WorkspaceModuleAccess } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

export const WorkspaceModuleAccessRepository = {
  async listByWorkspace(
    workspaceId: string,
  ): Promise<Result<WorkspaceModuleAccess[]>> {
    try {
      const access = await prisma.workspaceModuleAccess.findMany({
        where: { workspaceId },
      })
      return ok(access)
    } catch (error) {
      return err(dbError('Failed to list workspace module access', error))
    }
  },

  async upsert(
    workspaceId: string,
    module: ModuleKind,
    enabled: boolean,
    grantedById: string,
  ): Promise<Result<WorkspaceModuleAccess>> {
    try {
      const access = await prisma.workspaceModuleAccess.upsert({
        where: { workspaceId_module: { workspaceId, module } },
        create: { workspaceId, module, enabled, grantedById },
        update: { enabled, grantedById },
      })
      return ok(access)
    } catch (error) {
      return err(dbError('Failed to upsert workspace module access', error))
    }
  },

  async isEnabled(
    workspaceId: string,
    module: ModuleKind,
  ): Promise<Result<boolean>> {
    try {
      const access = await prisma.workspaceModuleAccess.findUnique({
        where: { workspaceId_module: { workspaceId, module } },
        select: { enabled: true, workspace: { select: { status: true } } },
      })
      // Workspace suspenso/em exclusão: módulo fechado também para as rotas
      // públicas (formulários, propostas, webhooks).
      return ok(
        (access?.enabled ?? false) && access?.workspace.status === 'ACTIVE',
      )
    } catch (error) {
      return err(dbError('Failed to check workspace module access', error))
    }
  },
}
