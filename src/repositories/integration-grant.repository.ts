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

/** A grant as the workspace admin sees it: who holds it and for which app. */
export type WorkspaceIntegrationGrantRow = IntegrationGrant & {
  client: IntegrationGrantWithRelations['client']
  user: { id: string; name: string; email: string; image: string | null }
}

const WITH_CLIENT_AND_USER = {
  client: WITH_RELATIONS.client,
  user: { select: { id: true, name: true, email: true, image: true } },
} as const

/** Which active grants of a workspace a bulk revocation targets. */
export type WorkspaceGrantFilter = { userId: string } | { clientId: string }

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

  /** Active grants of every member of a workspace, most recent first. */
  async listActiveByWorkspace(
    workspaceId: string,
  ): Promise<Result<WorkspaceIntegrationGrantRow[]>> {
    try {
      const grants = await prisma.integrationGrant.findMany({
        where: { workspaceId, revokedAt: null },
        include: WITH_CLIENT_AND_USER,
        orderBy: { createdAt: 'desc' },
      })
      return ok(grants)
    } catch (error) {
      return err(dbError('Failed to list workspace integration grants', error))
    }
  },

  /** Ids of the active grants of one member, or of one app, in a workspace. */
  async listActiveIdsByWorkspace(
    workspaceId: string,
    filter: WorkspaceGrantFilter,
  ): Promise<Result<string[]>> {
    try {
      const grants = await prisma.integrationGrant.findMany({
        where: { workspaceId, revokedAt: null, ...filter },
        select: { id: true },
      })
      return ok(grants.map((grant) => grant.id))
    } catch (error) {
      return err(dbError('Failed to list workspace integration grants', error))
    }
  },

  async create(data: {
    userId: string
    workspaceId: string
    clientId: string
    scopes: string[]
    modules: ModuleKind[]
    redirectHost?: string | null
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
    data: {
      scopes: string[]
      modules: ModuleKind[]
      redirectHost?: string | null
    },
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
   * `revoke` for several grants at once, in one transaction: only the ones
   * still active are touched. Resolves to how many were revoked.
   */
  async revokeMany(ids: string[], at: Date): Promise<Result<number>> {
    if (ids.length === 0) return ok(0)
    try {
      const referenceId = { in: ids }
      const [revoked] = await prisma.$transaction([
        prisma.integrationGrant.updateMany({
          where: { id: { in: ids }, revokedAt: null },
          data: { revokedAt: at },
        }),
        prisma.oauthAccessToken.deleteMany({ where: { referenceId } }),
        prisma.oauthRefreshToken.updateMany({
          where: { referenceId, revoked: null },
          data: { revoked: at },
        }),
        prisma.oauthConsent.deleteMany({ where: { referenceId } }),
      ])
      return ok(revoked.count)
    } catch (error) {
      return err(dbError('Failed to revoke integration grants', error))
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
