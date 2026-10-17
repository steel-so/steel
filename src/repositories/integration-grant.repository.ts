import type { IntegrationGrant, ModuleKind } from '@prisma/client'
import { notFound } from '@/src/errors'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

export type IntegrationGrantWithRelations = IntegrationGrant & {
  client: {
    clientId: string
    name: string | null
    icon: string | null
    uri: string | null
  }
  workspace: { id: string; name: string; slug: string }
}

const WITH_RELATIONS = {
  client: {
    select: { clientId: true, name: true, icon: true, uri: true },
  },
  workspace: { select: { id: true, name: true, slug: true } },
} as const

export const IntegrationGrantRepository = {
  async findById(id: string): Promise<Result<IntegrationGrant>> {
    try {
      const grant = await prisma.integrationGrant.findUnique({ where: { id } })
      if (!grant) return err(notFound('IntegrationGrant'))
      return ok(grant)
    } catch (error) {
      return err(dbError('Failed to find integration grant', error))
    }
  },

  /** The active (not revoked) grant of a user for a client on a workspace. */
  async findActive(
    userId: string,
    clientId: string,
    workspaceId: string,
  ): Promise<Result<IntegrationGrant | null>> {
    try {
      const grant = await prisma.integrationGrant.findFirst({
        where: { userId, clientId, workspaceId, revokedAt: null },
      })
      return ok(grant)
    } catch (error) {
      return err(dbError('Failed to find active integration grant', error))
    }
  },

  async listActiveByUser(
    userId: string,
  ): Promise<Result<IntegrationGrantWithRelations[]>> {
    try {
      const grants = await prisma.integrationGrant.findMany({
        where: { userId, revokedAt: null },
        include: WITH_RELATIONS,
        orderBy: { createdAt: 'desc' },
      })
      return ok(grants)
    } catch (error) {
      return err(dbError('Failed to list integration grants', error))
    }
  },

  async create(data: {
    userId: string
    workspaceId: string
    clientId: string
    scopes: string[]
    modules: ModuleKind[]
  }): Promise<Result<IntegrationGrant>> {
    try {
      const grant = await prisma.integrationGrant.create({ data })
      return ok(grant)
    } catch (error) {
      return err(dbError('Failed to create integration grant', error))
    }
  },

  async updateConsent(
    id: string,
    data: { scopes: string[]; modules: ModuleKind[] },
  ): Promise<Result<IntegrationGrant>> {
    try {
      const grant = await prisma.integrationGrant.update({
        where: { id },
        data,
      })
      return ok(grant)
    } catch (error) {
      return err(dbError('Failed to update integration grant', error))
    }
  },

  /** Undoes a grant created for a consent the provider then refused. */
  async delete(id: string): Promise<Result<void>> {
    try {
      await prisma.integrationGrant.delete({ where: { id } })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to delete integration grant', error))
    }
  },

  /**
   * Revokes the grant and everything the provider issued for it: access
   * tokens are deleted, refresh tokens marked revoked and the consent row
   * removed (so the next authorization asks again). Writes the client
   * proposed and nobody confirmed yet are canceled. One transaction.
   */
  async revoke(id: string, at: Date): Promise<Result<IntegrationGrant>> {
    try {
      const [grant] = await prisma.$transaction([
        prisma.integrationGrant.update({
          where: { id },
          data: { revokedAt: at },
        }),
        prisma.oauthAccessToken.deleteMany({ where: { referenceId: id } }),
        prisma.oauthRefreshToken.updateMany({
          where: { referenceId: id, revoked: null },
          data: { revoked: at },
        }),
        prisma.oauthConsent.deleteMany({ where: { referenceId: id } }),
        prisma.aiPendingAction.updateMany({
          where: { integrationGrantId: id, status: 'PENDING' },
          data: { status: 'CANCELED', decidedAt: at },
        }),
      ])
      return ok(grant)
    } catch (error) {
      return err(dbError('Failed to revoke integration grant', error))
    }
  },

  /**
   * Stamps `lastUsedAt` at most once per `throttleMs`: the conditional
   * update is a no-op while the last stamp is recent, so a busy MCP client
   * costs one write per minute, not one per call.
   */
  async touchLastUsed(
    id: string,
    now: Date,
    throttleMs: number,
  ): Promise<Result<boolean>> {
    try {
      const { count } = await prisma.integrationGrant.updateMany({
        where: {
          id,
          OR: [
            { lastUsedAt: null },
            { lastUsedAt: { lt: new Date(now.getTime() - throttleMs) } },
          ],
        },
        data: { lastUsedAt: now },
      })
      return ok(count > 0)
    } catch (error) {
      return err(dbError('Failed to touch integration grant', error))
    }
  },
}
