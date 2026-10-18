import type { ApiToken, ApiTokenCreatedVia, ModuleKind } from '@prisma/client'
import { notFound } from '@/src/errors'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

/** A token with its workspace, as the holder sees it. */
export type ApiTokenWithWorkspace = ApiToken & {
  workspace: { id: string; name: string; slug: string }
}

/** A token with its holder, as the workspace admin sees it. */
export type ApiTokenWithUser = ApiToken & {
  user: { id: string; name: string; email: string; image: string | null }
}

const WITH_WORKSPACE = {
  workspace: { select: { id: true, name: true, slug: true } },
} as const

const WITH_USER = {
  user: { select: { id: true, name: true, email: true, image: true } },
} as const

export interface CreateApiTokenData {
  userId: string
  workspaceId: string
  name: string
  tokenHash: string
  prefix: string
  scopes: string[]
  modules: ModuleKind[]
  expiresAt: Date
  createdVia: ApiTokenCreatedVia
  deviceName?: string | null
}

export const ApiTokenRepository = {
  async findById(id: string): Promise<Result<ApiToken>> {
    try {
      const token = await prisma.apiToken.findUnique({ where: { id } })
      if (!token) return err(notFound('ApiToken'))
      return ok(token)
    } catch (error) {
      return err(dbError('Failed to find API token', error))
    }
  },

  async findByHash(tokenHash: string): Promise<Result<ApiToken | null>> {
    try {
      const token = await prisma.apiToken.findUnique({ where: { tokenHash } })
      return ok(token)
    } catch (error) {
      return err(dbError('Failed to find API token by hash', error))
    }
  },

  /** Not revoked (expired ones included), most recent first. */
  async listByUser(userId: string): Promise<Result<ApiTokenWithWorkspace[]>> {
    try {
      const tokens = await prisma.apiToken.findMany({
        where: { userId, revokedAt: null },
        include: WITH_WORKSPACE,
        orderBy: { createdAt: 'desc' },
      })
      return ok(tokens)
    } catch (error) {
      return err(dbError('Failed to list API tokens', error))
    }
  },

  /** Not revoked tokens of every member of a workspace, most recent first. */
  async listByWorkspace(
    workspaceId: string,
  ): Promise<Result<ApiTokenWithUser[]>> {
    try {
      const tokens = await prisma.apiToken.findMany({
        where: { workspaceId, revokedAt: null },
        include: WITH_USER,
        orderBy: { createdAt: 'desc' },
      })
      return ok(tokens)
    } catch (error) {
      return err(dbError('Failed to list workspace API tokens', error))
    }
  },

  /** Tokens of a user that still work (not revoked, not expired). */
  async countActiveByUser(userId: string, now: Date): Promise<Result<number>> {
    try {
      const count = await prisma.apiToken.count({
        where: { userId, revokedAt: null, expiresAt: { gt: now } },
      })
      return ok(count)
    } catch (error) {
      return err(dbError('Failed to count API tokens', error))
    }
  },

  async create(
    data: CreateApiTokenData,
  ): Promise<Result<ApiTokenWithWorkspace>> {
    try {
      const token = await prisma.apiToken.create({
        data,
        include: WITH_WORKSPACE,
      })
      return ok(token)
    } catch (error) {
      return err(dbError('Failed to create API token', error))
    }
  },

  /**
   * Revokes a token that is still active; `false` when it was revoked
   * meanwhile (two clicks, two admins), so the caller can answer 404.
   */
  async revoke(id: string, at: Date): Promise<Result<boolean>> {
    try {
      const { count } = await prisma.apiToken.updateMany({
        where: { id, revokedAt: null },
        data: { revokedAt: at },
      })
      return ok(count > 0)
    } catch (error) {
      return err(dbError('Failed to revoke API token', error))
    }
  },

  /**
   * Stamps `lastUsedAt` at most once per `throttleMs`: the conditional
   * update is a no-op while the last stamp is recent, so a busy script costs
   * one write per minute, not one per call.
   */
  async touchLastUsed(
    id: string,
    now: Date,
    throttleMs: number,
  ): Promise<Result<boolean>> {
    try {
      const { count } = await prisma.apiToken.updateMany({
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
      return err(dbError('Failed to touch API token', error))
    }
  },
}
