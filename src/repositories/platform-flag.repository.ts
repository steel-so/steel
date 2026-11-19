import type { FeatureFlag } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

export type FeatureFlagWithCount = FeatureFlag & {
  _count: { workspaces: number }
}

export interface BetaWorkspaceRow {
  id: string
  name: string
  slug: string
  beta: boolean
}

const WITH_COUNT = { _count: { select: { workspaces: true } } } as const

export const PlatformFlagRepository = {
  async list(): Promise<Result<FeatureFlagWithCount[]>> {
    try {
      return ok(
        await prisma.featureFlag.findMany({
          orderBy: { key: 'asc' },
          include: WITH_COUNT,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list feature flags', error))
    }
  },

  async findById(id: string): Promise<Result<FeatureFlagWithCount | null>> {
    try {
      return ok(
        await prisma.featureFlag.findUnique({
          where: { id },
          include: WITH_COUNT,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to find feature flag', error))
    }
  },

  async findByKey(key: string): Promise<Result<FeatureFlag | null>> {
    try {
      return ok(await prisma.featureFlag.findUnique({ where: { key } }))
    } catch (error) {
      return err(dbError('Failed to find feature flag by key', error))
    }
  },

  async create(data: {
    key: string
    name: string
    description: string | null
    enabled: boolean
    betaEnabled: boolean
  }): Promise<Result<FeatureFlagWithCount>> {
    try {
      return ok(
        await prisma.featureFlag.create({ data, include: WITH_COUNT }),
      )
    } catch (error) {
      return err(dbError('Failed to create feature flag', error))
    }
  },

  async update(
    id: string,
    data: {
      name?: string
      description?: string | null
      enabled?: boolean
      betaEnabled?: boolean
    },
  ): Promise<Result<FeatureFlagWithCount>> {
    try {
      return ok(
        await prisma.featureFlag.update({
          where: { id },
          data,
          include: WITH_COUNT,
        }),
      )
    } catch (error) {
      return err(dbError('Failed to update feature flag', error))
    }
  },

  async delete(id: string): Promise<Result<true>> {
    try {
      await prisma.featureFlag.delete({ where: { id } })
      return ok(true)
    } catch (error) {
      return err(dbError('Failed to delete feature flag', error))
    }
  },

  async setGrant(
    flagId: string,
    workspaceId: string,
    granted: boolean,
  ): Promise<Result<true>> {
    try {
      if (granted) {
        await prisma.featureFlagWorkspace.upsert({
          where: { flagId_workspaceId: { flagId, workspaceId } },
          create: { flagId, workspaceId },
          update: {},
        })
      } else {
        await prisma.featureFlagWorkspace.deleteMany({
          where: { flagId, workspaceId },
        })
      }
      return ok(true)
    } catch (error) {
      return err(dbError('Failed to set feature flag grant', error))
    }
  },

  async setWorkspaceBeta(
    workspaceId: string,
    beta: boolean,
  ): Promise<Result<BetaWorkspaceRow>> {
    try {
      return ok(
        await prisma.workspace.update({
          where: { id: workspaceId },
          data: { beta },
          select: { id: true, name: true, slug: true, beta: true },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to set workspace beta', error))
    }
  },

  /** Workspaces (beta primeiro) com busca por nome/slug; teto de 50 linhas. */
  async listWorkspaces(search?: string): Promise<Result<BetaWorkspaceRow[]>> {
    try {
      return ok(
        await prisma.workspace.findMany({
          where: search
            ? {
                OR: [
                  { name: { contains: search, mode: 'insensitive' } },
                  { slug: { contains: search, mode: 'insensitive' } },
                ],
              }
            : undefined,
          orderBy: [{ beta: 'desc' }, { name: 'asc' }],
          take: 50,
          select: { id: true, name: true, slug: true, beta: true },
        }),
      )
    } catch (error) {
      return err(dbError('Failed to list beta workspaces', error))
    }
  },

  async listGrantedWorkspaceIds(flagId: string): Promise<Result<string[]>> {
    try {
      const rows = await prisma.featureFlagWorkspace.findMany({
        where: { flagId },
        select: { workspaceId: true },
      })
      return ok(rows.map((r) => r.workspaceId))
    } catch (error) {
      return err(dbError('Failed to list feature flag grants', error))
    }
  },

  /** Chaves ativas para o workspace: global OU liberada OU (beta e betaEnabled). */
  async listActiveKeys(workspaceId: string): Promise<Result<string[]>> {
    try {
      const workspace = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { beta: true },
      })
      if (!workspace) return ok([])
      const flags = await prisma.featureFlag.findMany({
        where: {
          OR: [
            { enabled: true },
            { workspaces: { some: { workspaceId } } },
            ...(workspace.beta ? [{ betaEnabled: true }] : []),
          ],
        },
        select: { key: true },
        orderBy: { key: 'asc' },
      })
      return ok(flags.map((f) => f.key))
    } catch (error) {
      return err(dbError('Failed to resolve active feature flags', error))
    }
  },
}
