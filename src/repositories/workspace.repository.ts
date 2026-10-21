import type {
  Plan,
  Workspace,
  WorkspaceCompanySize,
  WorkspaceStatus,
} from '@prisma/client'
import { conflict, notFound } from '@/src/errors'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

export const WorkspaceRepository = {
  async findById(id: string): Promise<Result<Workspace>> {
    try {
      const workspace = await prisma.workspace.findUnique({ where: { id } })

      if (!workspace) {
        return err(notFound('Workspace'))
      }

      return ok(workspace)
    } catch (error) {
      return err(dbError('Failed to find workspace by id', error))
    }
  },

  async findBySlug(slug: string): Promise<Result<Workspace | null>> {
    try {
      const workspace = await prisma.workspace.findUnique({ where: { slug } })
      return ok(workspace)
    } catch (error) {
      return err(dbError('Failed to find workspace by slug', error))
    }
  },

  /** Todos os workspaces com contagem de membros, para o painel admin global. */
  async listAllWithCounts(): Promise<
    Result<(Workspace & { memberCount: number })[]>
  > {
    try {
      const workspaces = await prisma.workspace.findMany({
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { memberships: true } } },
      })
      return ok(
        workspaces.map(({ _count, ...workspace }) => ({
          ...workspace,
          memberCount: _count.memberships,
        })),
      )
    } catch (error) {
      return err(dbError('Failed to list workspaces', error))
    }
  },

  async create(data: {
    name: string
    slug: string
  }): Promise<Result<Workspace>> {
    try {
      const workspace = await prisma.workspace.create({ data })
      return ok(workspace)
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'P2002') {
        return err(conflict('Slug já está em uso'))
      }
      return err(dbError('Failed to create workspace', error))
    }
  },

  async createWithOwner(
    data: {
      name: string
      slug: string
      activePlan?: Plan
      trialEndsAt?: Date | null
    },
    userId: string,
  ): Promise<Result<Workspace>> {
    try {
      const workspace = await prisma.$transaction(async (tx) => {
        const ws = await tx.workspace.create({ data })
        await tx.membership.create({
          data: { userId, workspaceId: ws.id, role: 'OWNER' },
        })

        await tx.user.update({
          where: { id: userId },
          data: { onboardingStep: null },
        })
        return ws
      })
      return ok(workspace)
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'P2002') {
        return err(conflict('Slug já está em uso'))
      }
      return err(dbError('Failed to create workspace', error))
    }
  },

  async update(
    id: string,
    data: {
      name?: string
      slug?: string
      companySize?: WorkspaceCompanySize | null
      logoUrl?: string | null
    },
  ): Promise<Result<Workspace>> {
    try {
      const workspace = await prisma.workspace.update({ where: { id }, data })
      return ok(workspace)
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'P2002') {
        return err(conflict('Slug já está em uso'))
      }
      return err(dbError('Failed to update workspace', error))
    }
  },

  /** Workspace + contagem de membros (detalhe do painel admin). */
  async findWithMemberCount(
    id: string,
  ): Promise<Result<(Workspace & { memberCount: number }) | null>> {
    try {
      const workspace = await prisma.workspace.findUnique({
        where: { id },
        include: { _count: { select: { memberships: true } } },
      })
      if (!workspace) return ok(null)
      const { _count, ...rest } = workspace
      return ok({ ...rest, memberCount: _count.memberships })
    } catch (error) {
      return err(dbError('Failed to find workspace with counts', error))
    }
  },

  /** Ciclo de vida controlado pelo admin global (suspender/reativar/excluir). */
  async setAllowedIps(
    id: string,
    allowedIps: string[],
  ): Promise<Result<Workspace>> {
    try {
      const workspace = await prisma.workspace.update({
        where: { id },
        data: { allowedIps },
      })
      return ok(workspace)
    } catch (error) {
      return err(dbError('Failed to set workspace allowed IPs', error))
    }
  },

  async setStatus(
    id: string,
    data: {
      status: WorkspaceStatus
      suspendedAt?: Date | null
      suspendedReason?: string | null
      suspendedById?: string | null
    },
  ): Promise<Result<Workspace>> {
    try {
      const workspace = await prisma.workspace.update({ where: { id }, data })
      return ok(workspace)
    } catch (error) {
      return err(dbError('Failed to set workspace status', error))
    }
  },

  /**
   * Troca manual de plano pelo admin global (ex.: ENTERPRISE negociado fora do
   * AbacatePay). Zera o trial para o `revertExpiredTrials` não desfazer.
   */
  async setPlan(id: string, plan: Plan): Promise<Result<Workspace>> {
    try {
      const workspace = await prisma.workspace.update({
        where: { id },
        data: { activePlan: plan, trialEndsAt: null },
      })
      return ok(workspace)
    } catch (error) {
      return err(dbError('Failed to set workspace plan', error))
    }
  },

  async revertExpiredTrials(now: Date = new Date()): Promise<Result<string[]>> {
    try {
      const expired = await prisma.workspace.findMany({
        where: {
          trialEndsAt: { lt: now },
          activePlan: { not: 'FREE' },
          subscriptions: { none: { status: 'PAID' } },
        },
        select: { id: true },
      })
      if (expired.length === 0) return ok([])

      const ids = expired.map((w) => w.id)
      await prisma.workspace.updateMany({
        where: { id: { in: ids } },
        data: { activePlan: 'FREE' },
      })
      return ok(ids)
    } catch (error) {
      return err(dbError('Failed to revert expired trials', error))
    }
  },

  async delete(id: string): Promise<Result<void>> {
    try {
      await prisma.workspace.delete({ where: { id } })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to delete workspace', error))
    }
  },
}
