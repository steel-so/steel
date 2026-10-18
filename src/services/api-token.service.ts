import type { ApiTokenCreatedVia, ModuleKind } from '@prisma/client'
import { auditAuth } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import {
  apiTokenLimitReached,
  apiTokenNotFound,
  moduleDisabled,
  unauthorized,
} from '@/src/errors'
import type { AppError } from '@/src/errors/app-error'
import type { ApiScope, ApiSession } from '@/src/lib/api/session'
import {
  apiTokenExpiry,
  generateApiToken,
  hashApiToken,
  isApiTokenFormat,
  sortApiModules,
  toApiScopes,
} from '@/src/lib/api/token'
import { err, ok, type Result } from '@/src/lib/result'
import {
  toApiTokenDTO,
  toWorkspaceApiTokenDTO,
} from '@/src/mappers/api-token.mapper'
import { ApiTokenRepository } from '@/src/repositories/api-token.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import type { CreateApiTokenInput } from '@/src/schemas/api-token.schema'
import {
  assertMember,
  assertPrivileged,
  assertWorkspaceActive,
} from '@/src/services/authz'
import type {
  ApiTokenCreatedDTO,
  ApiTokenDTO,
  ApiTokenWorkspaceOptionDTO,
  WorkspaceApiTokenDTO,
} from '@/types/api-token'

/**
 * Personal API tokens (ADR 0035): a user's credential for the public API
 * v1, bound to one workspace, scopes and modules. This service owns the
 * "Tokens de API" lists (holder and workspace admin), issuing (Ajustes and
 * the CLI device flow) and the resolution of a bearer token to its
 * `ApiSession`.
 */

/** `lastUsedAt` is written at most once per minute per token. */
export const API_TOKEN_LAST_USED_THROTTLE_MS = 60_000

/** Working (not revoked, not expired) tokens a user may hold at once. */
export const MAX_ACTIVE_API_TOKENS = 50

const TOKEN_INVALID = 'Token de API inválido, expirado ou revogado'

export interface IssueApiTokenInput {
  workspaceId: string
  name: string
  scopes: ApiScope[]
  modules: ModuleKind[]
  expiresInDays: number
  createdVia: ApiTokenCreatedVia
  deviceName?: string | null
}

async function enabledModules(
  workspaceId: string,
): Promise<Result<ModuleKind[]>> {
  const access =
    await WorkspaceModuleAccessRepository.listByWorkspace(workspaceId)
  if (!access.ok) return access
  return ok(
    sortApiModules(access.value.filter((m) => m.enabled).map((m) => m.module)),
  )
}

/** Not-found reads as the token's own 404; anything else propagates. */
function asTokenNotFound(error: AppError): Result<never> {
  return err(error.code === 'RESOURCE_NOT_FOUND' ? apiTokenNotFound() : error)
}

export const ApiTokenService = {
  /**
   * Issues a token for `userId`: member of the workspace (active), modules
   * enabled there, under the per-user cap. The value comes back only here.
   */
  async issue(
    userId: string,
    input: IssueApiTokenInput,
    now: Date = new Date(),
  ): Promise<Result<ApiTokenCreatedDTO>> {
    const membership = await assertMember(userId, input.workspaceId)
    if (!membership.ok) return membership

    const enabled = await enabledModules(input.workspaceId)
    if (!enabled.ok) return enabled
    if (!input.modules.every((module) => enabled.value.includes(module))) {
      return err(moduleDisabled())
    }

    const active = await ApiTokenRepository.countActiveByUser(userId, now)
    if (!active.ok) return active
    if (active.value >= MAX_ACTIVE_API_TOKENS) {
      return err(apiTokenLimitReached(MAX_ACTIVE_API_TOKENS))
    }

    const generated = generateApiToken()
    const scopes = toApiScopes(input.scopes)
    const modules = sortApiModules(input.modules)
    const created = await ApiTokenRepository.create({
      userId,
      workspaceId: input.workspaceId,
      name: input.name,
      tokenHash: generated.tokenHash,
      prefix: generated.prefix,
      scopes,
      modules,
      expiresAt: apiTokenExpiry(now, input.expiresInDays),
      createdVia: input.createdVia,
      deviceName: input.deviceName ?? null,
    })
    if (!created.ok) return created

    auditAuth({
      event: 'auth.api_token.created',
      userId,
      meta: {
        tokenId: created.value.id,
        workspaceId: input.workspaceId,
        scopes,
        modules,
        createdVia: input.createdVia,
        expiresAt: created.value.expiresAt.toISOString(),
      },
    })
    return ok({ ...toApiTokenDTO(created.value, now), token: generated.token })
  },

  /**
   * Workspaces a token may be created for: the user's active ones with at
   * least one enabled module, and those modules.
   */
  async listGrantableWorkspaces(
    userId: string,
  ): Promise<Result<ApiTokenWorkspaceOptionDTO[]>> {
    const memberships = await MembershipRepository.listByUser(userId)
    if (!memberships.ok) return memberships

    const workspaces: ApiTokenWorkspaceOptionDTO[] = []
    for (const membership of memberships.value) {
      if (!assertWorkspaceActive(membership.workspace.status).ok) continue
      const modules = await enabledModules(membership.workspaceId)
      if (!modules.ok) return modules
      if (modules.value.length === 0) continue
      workspaces.push({
        id: membership.workspace.id,
        name: membership.workspace.name,
        slug: membership.workspace.slug,
        modules: modules.value,
      })
    }
    return ok(workspaces)
  },

  /** "Tokens de API" › Criar token (Configurações › Segurança). */
  createForUser(
    userId: string,
    input: CreateApiTokenInput,
  ): Promise<Result<ApiTokenCreatedDTO>> {
    return ApiTokenService.issue(userId, {
      workspaceId: input.workspaceId,
      name: input.name,
      scopes: input.scopes,
      modules: input.modules,
      expiresInDays: input.expiresInDays,
      createdVia: 'SETTINGS',
    })
  },

  async listForUser(
    userId: string,
    now: Date = new Date(),
  ): Promise<Result<ApiTokenDTO[]>> {
    const tokens = await ApiTokenRepository.listByUser(userId)
    if (!tokens.ok) return tokens
    return ok(tokens.value.map((token) => toApiTokenDTO(token, now)))
  },

  /** Revokes one of the user's own tokens; anyone else's reads as missing. */
  async revokeForUser(
    userId: string,
    tokenId: string,
  ): Promise<Result<{ id: string }>> {
    const token = await ApiTokenRepository.findById(tokenId)
    if (!token.ok) return asTokenNotFound(token.error)
    if (token.value.userId !== userId || token.value.revokedAt) {
      return err(apiTokenNotFound())
    }

    const revoked = await ApiTokenRepository.revoke(tokenId, new Date())
    if (!revoked.ok) return revoked
    if (!revoked.value) return err(apiTokenNotFound())

    auditAuth({
      event: 'auth.api_token.revoked',
      userId,
      meta: {
        tokenId,
        workspaceId: token.value.workspaceId,
        holderId: token.value.userId,
        by: 'holder',
      },
    })
    return ok({ id: tokenId })
  },

  /**
   * `DELETE /api/v1/auth/token` (`steel logout`): revokes the token the
   * request was authenticated with.
   */
  async revokeCurrent(session: {
    tokenId: string
    userId: string
  }): Promise<Result<{ id: string }>> {
    return ApiTokenService.revokeForUser(session.userId, session.tokenId)
  },

  /** Workspace "Tokens de API" (OWNER/ADMIN): every member's tokens. */
  async listForWorkspace(
    actorId: string,
    workspaceId: string,
    now: Date = new Date(),
  ): Promise<Result<WorkspaceApiTokenDTO[]>> {
    const membership = await assertPrivileged(actorId, workspaceId)
    if (!membership.ok) return membership

    const tokens = await ApiTokenRepository.listByWorkspace(workspaceId)
    if (!tokens.ok) return tokens
    return ok(tokens.value.map((token) => toWorkspaceApiTokenDTO(token, now)))
  },

  /** OWNER/ADMIN revoke a member's token; one of another workspace reads as missing. */
  async revokeForWorkspace(
    actorId: string,
    workspaceId: string,
    tokenId: string,
  ): Promise<Result<{ id: string }>> {
    const membership = await assertPrivileged(actorId, workspaceId)
    if (!membership.ok) return membership

    const token = await ApiTokenRepository.findById(tokenId)
    if (!token.ok) return asTokenNotFound(token.error)
    if (token.value.workspaceId !== workspaceId || token.value.revokedAt) {
      return err(apiTokenNotFound())
    }

    const revoked = await ApiTokenRepository.revoke(tokenId, new Date())
    if (!revoked.ok) return revoked
    if (!revoked.value) return err(apiTokenNotFound())

    auditAuth({
      event: 'auth.api_token.revoked',
      userId: actorId,
      meta: {
        tokenId,
        workspaceId,
        holderId: token.value.userId,
        by: 'workspace_admin',
      },
    })
    return ok({ id: tokenId })
  },

  /**
   * Resolves a bearer value to its `ApiSession`. Malformed, unknown,
   * revoked or expired tokens, holders who are no longer members and
   * suspended workspaces are all `UNAUTHORIZED`; database failures
   * propagate as they are. Modules are narrowed to the ones still enabled.
   */
  async resolveToken(
    rawToken: string,
    now: Date = new Date(),
  ): Promise<Result<ApiSession>> {
    if (!isApiTokenFormat(rawToken)) return err(unauthorized(TOKEN_INVALID))

    const found = await ApiTokenRepository.findByHash(hashApiToken(rawToken))
    if (!found.ok) return found
    const token = found.value
    if (
      !token ||
      token.revokedAt ||
      token.expiresAt.getTime() <= now.getTime()
    ) {
      return err(unauthorized(TOKEN_INVALID))
    }

    const membership = await assertMember(token.userId, token.workspaceId)
    if (!membership.ok) {
      return membership.error.code === 'DATABASE_ERROR'
        ? membership
        : err(unauthorized(TOKEN_INVALID))
    }

    const scopes = toApiScopes(token.scopes)
    if (!scopes.includes('api:read')) return err(unauthorized(TOKEN_INVALID))

    const enabled = await enabledModules(token.workspaceId)
    if (!enabled.ok) return enabled

    const touched = await ApiTokenRepository.touchLastUsed(
      token.id,
      now,
      API_TOKEN_LAST_USED_THROTTLE_MS,
    )
    if (!touched.ok) {
      // Bookkeeping only: the call itself goes on.
      logger.warn('api_token.touch_failed', { tokenId: token.id })
    }

    return ok({
      tokenId: token.id,
      userId: token.userId,
      workspaceId: token.workspaceId,
      scopes,
      modules: token.modules.filter((m) => enabled.value.includes(m)),
      expiresAt: token.expiresAt,
    })
  },
}
