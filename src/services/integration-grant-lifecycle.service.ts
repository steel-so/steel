import type { IntegrationGrant } from '@prisma/client'
import { auditAuth } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { OAUTH_TOKEN_PREFIX } from '@/src/lib/mcp/oauth-config'
import { hashOpaqueToken } from '@/src/lib/mcp/oauth-utils'
import { ok, type Result } from '@/src/lib/result'
import { IntegrationGrantRepository } from '@/src/repositories/integration-grant.repository'
import {
  OauthClientRepository,
  type OauthTokenHolder,
} from '@/src/repositories/oauth-client.repository'

/**
 * Retires integration grants (ADR 0033) that no token can use any more, so
 * "Apps conectados" does not keep a dead entry after the client revoked its
 * tokens (`steel mcp logout`), after the provider killed a refresh-token
 * family on reuse, or after every token simply expired.
 *
 * A grant is retired only when it has no live token: a refresh token
 * neither revoked nor expired, or an unexpired access token not tied to a
 * revoked refresh token (rotation leaves those behind; retiring deletes
 * them). That rule
 * makes every trigger safe — a revocation that failed, or a refresh refused
 * for another reason, leaves a usable grant alone.
 */

/** Why a grant was retired, recorded in the audit event. */
export type GrantRetirementSource =
  | 'token_revoked'
  | 'refresh_rejected'
  | 'retention'

/**
 * Grants touched this recently are left out of the checks that are not
 * about one specific grant: the user may be between consent and the code
 * exchange (codes live 10 minutes), when a grant has no token yet.
 */
export const IN_FLIGHT_GRACE_MS = 15 * 60_000

/** The nightly prune only looks at grants idle for at least a day. */
export const PRUNE_IDLE_MS = 24 * 60 * 60_000

/** Upper bound of batches one nightly prune walks through. */
export const MAX_PRUNE_BATCHES = 20

/** The token kind a raw value belongs to, from its prefix. */
function tokenKind(rawToken: string) {
  const { opaqueAccessToken, refreshToken } = OAUTH_TOKEN_PREFIX
  if (rawToken.startsWith(opaqueAccessToken)) {
    return {
      kind: 'access_token' as const,
      value: rawToken.slice(opaqueAccessToken.length),
    }
  }
  if (rawToken.startsWith(refreshToken)) {
    return {
      kind: 'refresh_token' as const,
      value: rawToken.slice(refreshToken.length),
    }
  }
  return null
}

async function retire(
  grants: IntegrationGrant[],
  source: GrantRetirementSource,
  now: Date,
): Promise<Result<number>> {
  if (grants.length === 0) return ok(0)
  const revoked = await IntegrationGrantRepository.revokeMany(
    grants.map((grant) => grant.id),
    now,
  )
  if (!revoked.ok) return revoked
  for (const grant of grants) {
    auditAuth({
      event: 'auth.integration_grant.expired',
      userId: grant.userId,
      meta: {
        grantId: grant.id,
        clientId: grant.clientId,
        workspaceId: grant.workspaceId,
        source,
      },
    })
  }
  return ok(revoked.value)
}

export const IntegrationGrantLifecycleService = {
  /**
   * Who holds a raw token (`stl_at_…` or `stl_rt_…`), read before the
   * provider revokes or rotates it — afterwards the access token row is
   * gone. Anything else, or an unknown token, has no holder.
   */
  async findTokenHolder(
    rawToken: string,
  ): Promise<Result<OauthTokenHolder | null>> {
    const parsed = tokenKind(rawToken)
    if (!parsed || parsed.value.length === 0) return ok(null)
    return OauthClientRepository.findTokenHolderByHash(
      parsed.kind,
      hashOpaqueToken(parsed.value),
    )
  },

  /**
   * After the provider answered a revocation or a refresh for `holder`'s
   * token: retires the token's grant when nothing live is left on it. A
   * refused refresh may have killed the whole refresh family of the client
   * and user (reuse detection), so their other idle grants are checked too.
   */
  async retireAfterTokenEvent(
    holder: OauthTokenHolder,
    source: Exclude<GrantRetirementSource, 'retention'>,
    now: Date = new Date(),
  ): Promise<Result<number>> {
    const dead = new Map<string, IntegrationGrant>()

    if (holder.referenceId) {
      const own = await IntegrationGrantRepository.listWithoutLiveTokens(
        { ids: [holder.referenceId] },
        now,
      )
      if (!own.ok) return own
      for (const grant of own.value.dead) {
        // A token that points at someone else's grant retires nothing.
        if (
          grant.clientId === holder.clientId &&
          grant.userId === holder.userId
        ) {
          dead.set(grant.id, grant)
        }
      }
    }

    if (source === 'refresh_rejected') {
      const family = await IntegrationGrantRepository.listWithoutLiveTokens(
        {
          clientId: holder.clientId,
          userId: holder.userId,
          updatedBefore: new Date(now.getTime() - IN_FLIGHT_GRACE_MS),
        },
        now,
      )
      if (!family.ok) return family
      for (const grant of family.value.dead) dead.set(grant.id, grant)
    }

    const retired = await retire([...dead.values()], source, now)
    if (retired.ok && retired.value > 0) {
      logger.info('integration_grant.retired', {
        clientId: holder.clientId,
        source,
        retired: retired.value,
      })
    }
    return retired
  },

  /**
   * Nightly (data-retention): retires every grant idle for a day with no
   * live token — clients that never revoked, whose tokens expired. Walks
   * the candidates by id, at most `MAX_PRUNE_BATCHES` batches a night.
   * Resolves to how many were retired.
   */
  async pruneWithoutLiveTokens(
    now: Date = new Date(),
  ): Promise<Result<number>> {
    const updatedBefore = new Date(now.getTime() - PRUNE_IDLE_MS)
    let total = 0
    let cursor: string | undefined
    for (let batch = 0; batch < MAX_PRUNE_BATCHES; batch++) {
      const page = await IntegrationGrantRepository.listWithoutLiveTokens(
        { updatedBefore },
        now,
        cursor,
      )
      if (!page.ok) return page
      const retired = await retire(page.value.dead, 'retention', now)
      if (!retired.ok) return retired
      total += retired.value
      if (!page.value.nextCursor) break
      cursor = page.value.nextCursor
    }
    return ok(total)
  },
}
