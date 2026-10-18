import type { ModuleKind } from '@prisma/client'
import { auditAuth } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import {
  integrationGrantNotFound,
  moduleDisabled,
  oauthRequestInvalid,
  unauthorized,
  validationError,
} from '@/src/errors'
import type { AppError } from '@/src/errors/app-error'
import {
  classifyRedirectUri,
  type OAuthDestination,
} from '@/src/lib/mcp/client-trust'
import { MCP_CONSENT_NOTICE_VERSION } from '@/src/lib/mcp/consent-notice'
import type { McpGrant } from '@/src/lib/mcp/grant'
import { OAUTH_TOKEN_PREFIX } from '@/src/lib/mcp/oauth-config'
import { OAuthProviderGateway } from '@/src/lib/mcp/oauth-provider'
import {
  hashOpaqueToken,
  isOAuthQueryExpired,
  type ParsedOAuthQuery,
  parseOAuthQuery,
} from '@/src/lib/mcp/oauth-utils'
import { err, ok, type Result } from '@/src/lib/result'
import {
  toIntegrationGrantDTO,
  toMcpScopes,
} from '@/src/mappers/integration-grant.mapper'
import { IntegrationGrantRepository } from '@/src/repositories/integration-grant.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import {
  OauthClientRepository,
  type OauthClientSummary,
} from '@/src/repositories/oauth-client.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import type {
  OAuthConsentAcceptInput,
  OAuthConsentInput,
} from '@/src/schemas/integration-grant.schema'
import { assertMember, assertWorkspaceActive } from '@/src/services/authz'
import type {
  IntegrationGrantDTO,
  OAuthConsentContextDTO,
  OAuthConsentResultDTO,
} from '@/types/integration-grant'

/**
 * Integration grants (ADR 0033): what an OAuth client may do on behalf of a
 * user — one workspace, the consented scopes and modules. This service owns
 * the consent, the user's "Apps conectados" list and the resolution of an
 * MCP access token to its grant.
 */

/** `lastUsedAt` is written at most once per minute per grant. */
export const LAST_USED_THROTTLE_MS = 60_000

const MODULE_ORDER: readonly ModuleKind[] = [
  'SERVICE_DESK',
  'CRM',
  'COMMUNICATION',
]

const TOKEN_INVALID = 'Token de integração inválido'

function sortModules(modules: Iterable<ModuleKind>): ModuleKind[] {
  const set = new Set(modules)
  return MODULE_ORDER.filter((module) => set.has(module))
}

async function enabledModules(
  workspaceId: string,
): Promise<Result<ModuleKind[]>> {
  const access =
    await WorkspaceModuleAccessRepository.listByWorkspace(workspaceId)
  if (!access.ok) return access
  return ok(
    sortModules(access.value.filter((m) => m.enabled).map((m) => m.module)),
  )
}

interface ConsentRequest {
  query: ParsedOAuthQuery
  client: OauthClientSummary
  /** From the request's `redirect_uri` — never from client display data. */
  destination: OAuthDestination
}

/**
 * Parses the signed query and loads its client; both must be usable. The
 * destination comes from the `redirect_uri` the provider validated before
 * signing; a query without a usable one is not a request we can show.
 */
async function loadRequest(
  oauthQuery: string,
): Promise<Result<ConsentRequest, AppError>> {
  const query = parseOAuthQuery(oauthQuery)
  if (!query || isOAuthQueryExpired(query, new Date())) {
    return err(oauthRequestInvalid())
  }
  const destination = classifyRedirectUri(query.redirectUri)
  if (!destination) return err(oauthRequestInvalid())
  const client = await OauthClientRepository.findByClientId(query.clientId)
  if (!client.ok) return client
  if (!client.value || client.value.disabled) return err(oauthRequestInvalid())
  return ok({ query, client: client.value, destination })
}

function clientDTO(client: OauthClientSummary) {
  return {
    clientId: client.clientId,
    name: client.name,
    icon: client.icon,
    uri: client.uri,
  }
}

async function acceptConsent(
  userId: string,
  input: OAuthConsentAcceptInput,
  headers: Headers,
): Promise<Result<OAuthConsentResultDTO>> {
  const request = await loadRequest(input.oauthQuery)
  if (!request.ok) return request
  const { query, client, destination } = request.value

  // The user can narrow what the client asked for, never widen it.
  if (!input.scopes.every((scope) => query.scopes.includes(scope))) {
    return err(validationError('O app não pediu este nível de acesso'))
  }

  const membership = await assertMember(userId, input.workspaceId)
  if (!membership.ok) return membership

  const enabled = await enabledModules(input.workspaceId)
  if (!enabled.ok) return enabled
  if (!input.modules.every((module) => enabled.value.includes(module))) {
    return err(moduleDisabled())
  }
  const modules = sortModules(input.modules)
  const scopes = toMcpScopes(input.scopes)

  const existing = await IntegrationGrantRepository.findActive(
    userId,
    client.clientId,
    input.workspaceId,
  )
  if (!existing.ok) return existing

  const saved = existing.value
    ? await IntegrationGrantRepository.updateConsent(existing.value.id, {
        scopes,
        modules,
        redirectHost: destination.host,
      })
    : await IntegrationGrantRepository.create({
        userId,
        workspaceId: input.workspaceId,
        clientId: client.clientId,
        scopes,
        modules,
        redirectHost: destination.host,
      })
  if (!saved.ok) return saved
  const grant = saved.value

  // `offline_access` (refresh token) rides along when the client asked.
  const acceptedScopes = query.scopes.includes('offline_access')
    ? [...scopes, 'offline_access']
    : scopes

  const result = await OAuthProviderGateway.consent({
    headers,
    oauthQuery: input.oauthQuery,
    accept: true,
    scope: acceptedScopes.join(' '),
    grantId: grant.id,
  })

  if (!result.ok) {
    // Leave the grant as it was before this attempt.
    const undo = existing.value
      ? await IntegrationGrantRepository.updateConsent(grant.id, {
          scopes: existing.value.scopes,
          modules: existing.value.modules,
          redirectHost: existing.value.redirectHost,
        })
      : await IntegrationGrantRepository.delete(grant.id)
    if (!undo.ok) {
      logger.error('integration_grant.consent_undo_failed', {
        grantId: grant.id,
      })
    }
    return result
  }

  auditAuth({
    event: 'auth.oauth_consent.granted',
    userId,
    meta: {
      grantId: grant.id,
      clientId: client.clientId,
      // Self-declared by the client; `redirectHost` is what the user saw
      // as its identity, and `clientTrust` how the screen labeled it.
      clientName: client.name,
      redirectHost: destination.host,
      clientTrust: destination.trust,
      workspaceId: input.workspaceId,
      scopes,
      modules,
      // Which LGPD notice the user saw on the consent screen.
      noticeVersion: MCP_CONSENT_NOTICE_VERSION,
    },
  })
  return ok(result.value)
}

export const IntegrationGrantService = {
  /** Everything the consent page renders for a signed authorization request. */
  async getConsentContext(
    userId: string,
    oauthQuery: string,
  ): Promise<Result<OAuthConsentContextDTO>> {
    const request = await loadRequest(oauthQuery)
    if (!request.ok) return request
    const { query, client, destination } = request.value

    // The page shows `redirect_uri` as the app's identity, so a forged
    // query must not render — the plugin would only catch it on submit.
    if (!(await OAuthProviderGateway.verifyQuery(oauthQuery))) {
      logger.warn('oauth.consent.invalid_signature', {
        clientId: query.clientId,
      })
      return err(oauthRequestInvalid())
    }

    const requestedScopes = toMcpScopes(query.scopes)
    if (!requestedScopes.includes('mcp:read')) {
      return err(
        oauthRequestInvalid('Este app não pediu acesso ao Steel pelo MCP.'),
      )
    }

    const memberships = await MembershipRepository.listByUser(userId)
    if (!memberships.ok) return memberships

    const workspaces: OAuthConsentContextDTO['workspaces'] = []
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

    return ok({
      client: clientDTO(client),
      destination,
      requestedScopes,
      workspaces,
    })
  },

  /**
   * Answers the consent: accepting creates (or updates) the grant and lets
   * the provider issue the code bound to it; refusing sends the client an
   * `access_denied`.
   */
  async consent(
    userId: string,
    input: OAuthConsentInput,
    headers: Headers,
  ): Promise<Result<OAuthConsentResultDTO>> {
    if (input.accept) return acceptConsent(userId, input, headers)

    const result = await OAuthProviderGateway.consent({
      headers,
      oauthQuery: input.oauthQuery,
      accept: false,
    })
    if (result.ok) {
      auditAuth({
        event: 'auth.oauth_consent.denied',
        userId,
        meta: { clientId: parseOAuthQuery(input.oauthQuery)?.clientId },
      })
    }
    return result
  },

  async listForUser(userId: string): Promise<Result<IntegrationGrantDTO[]>> {
    const grants = await IntegrationGrantRepository.listActiveByUser(userId)
    if (!grants.ok) return grants
    return ok(grants.value.map(toIntegrationGrantDTO))
  },

  /** Revokes one of the user's own grants; anyone else's reads as missing. */
  async revokeForUser(
    userId: string,
    grantId: string,
  ): Promise<Result<{ id: string }>> {
    const grant = await IntegrationGrantRepository.findById(grantId)
    if (!grant.ok) {
      return grant.error.code === 'RESOURCE_NOT_FOUND'
        ? err(integrationGrantNotFound())
        : grant
    }
    if (grant.value.userId !== userId || grant.value.revokedAt) {
      return err(integrationGrantNotFound())
    }

    const revoked = await IntegrationGrantRepository.revoke(grantId, new Date())
    if (!revoked.ok) return revoked

    auditAuth({
      event: 'auth.integration_grant.revoked',
      userId,
      meta: {
        grantId,
        clientId: grant.value.clientId,
        workspaceId: grant.value.workspaceId,
      },
    })
    return ok({ id: grantId })
  },

  /**
   * Resolves an MCP access token to its grant. Unknown, expired or
   * foreign-prefixed tokens, disabled clients, revoked grants and users who
   * are no longer members (or whose workspace is suspended) are all
   * `UNAUTHORIZED` — the client should run the OAuth flow again. Database
   * failures propagate as they are.
   */
  async resolveAccessToken(
    rawToken: string,
    now: Date = new Date(),
  ): Promise<Result<McpGrant>> {
    const prefix = OAUTH_TOKEN_PREFIX.opaqueAccessToken
    if (!rawToken.startsWith(prefix) || rawToken.length === prefix.length) {
      return err(unauthorized(TOKEN_INVALID))
    }

    const token = await OauthClientRepository.findAccessTokenByHash(
      hashOpaqueToken(rawToken.slice(prefix.length)),
    )
    if (!token.ok) return token
    const row = token.value
    if (
      !row?.expiresAt ||
      row.expiresAt.getTime() <= now.getTime() ||
      row.client.disabled ||
      !row.referenceId ||
      !row.userId
    ) {
      return err(unauthorized(TOKEN_INVALID))
    }

    const grant = await IntegrationGrantRepository.findById(row.referenceId)
    if (!grant.ok) {
      return grant.error.code === 'RESOURCE_NOT_FOUND'
        ? err(unauthorized(TOKEN_INVALID))
        : grant
    }
    const value = grant.value
    if (
      value.revokedAt ||
      value.userId !== row.userId ||
      value.clientId !== row.clientId
    ) {
      return err(unauthorized(TOKEN_INVALID))
    }

    const membership = await assertMember(value.userId, value.workspaceId)
    if (!membership.ok) {
      return membership.error.code === 'DATABASE_ERROR'
        ? membership
        : err(unauthorized(TOKEN_INVALID))
    }

    const enabled = await enabledModules(value.workspaceId)
    if (!enabled.ok) return enabled

    const scopes = toMcpScopes(
      row.scopes.filter((s) => value.scopes.includes(s)),
    )
    if (!scopes.includes('mcp:read')) return err(unauthorized(TOKEN_INVALID))

    const touched = await IntegrationGrantRepository.touchLastUsed(
      value.id,
      now,
      LAST_USED_THROTTLE_MS,
    )
    if (!touched.ok) {
      // Bookkeeping only: the call itself goes on.
      logger.warn('integration_grant.touch_failed', { grantId: value.id })
    }

    return ok({
      grantId: value.id,
      userId: value.userId,
      workspaceId: value.workspaceId,
      clientId: row.clientId,
      clientName: row.client.name,
      scopes,
      modules: value.modules.filter((m) => enabled.value.includes(m)),
    })
  },
}
