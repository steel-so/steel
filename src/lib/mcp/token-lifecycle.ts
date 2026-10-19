import { logger } from '@/lib/axiom/logger'
import {
  type GrantRetirementSource,
  IntegrationGrantLifecycleService,
} from '@/src/services/integration-grant-lifecycle.service'

/**
 * Wraps the provider's revoke and token endpoints so a grant with no live
 * token left is retired right away (ADR 0033): `steel mcp logout` revokes
 * its refresh token, and a refused refresh may have killed the token family.
 * The token's holder is read before the provider runs — afterwards an
 * access token row is gone. Bookkeeping never changes the response.
 */

export const OAUTH_REVOKE_PATH = '/api/auth/oauth2/revoke'
export const OAUTH_TOKEN_PATH = '/api/auth/oauth2/token'

type TokenEvent = {
  token: string
  source: Exclude<GrantRetirementSource, 'retention'>
}

async function readParams(request: Request): Promise<URLSearchParams | null> {
  try {
    const body = await request.clone().text()
    const type = request.headers.get('content-type') ?? ''
    if (type.includes('application/json')) {
      const json: unknown = JSON.parse(body)
      if (!json || typeof json !== 'object') return null
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries(json)) {
        if (typeof value === 'string') params.set(key, value)
      }
      return params
    }
    return new URLSearchParams(body)
  } catch {
    return null
  }
}

/** The token a revoke or refresh request is about, or `null`. */
export async function tokenEventOf(
  request: Request,
  pathname: string,
): Promise<TokenEvent | null> {
  if (request.method !== 'POST') return null
  if (pathname !== OAUTH_REVOKE_PATH && pathname !== OAUTH_TOKEN_PATH) {
    return null
  }
  const params = await readParams(request)
  if (!params) return null
  if (pathname === OAUTH_REVOKE_PATH) {
    const token = params.get('token')?.replace(/^Bearer /, '')
    return token ? { token, source: 'token_revoked' } : null
  }
  if (params.get('grant_type') !== 'refresh_token') return null
  const token = params.get('refresh_token')
  return token ? { token, source: 'refresh_rejected' } : null
}

export async function withGrantLifecycle(
  request: Request,
  pathname: string,
  handle: (request: Request) => Promise<Response>,
): Promise<Response> {
  const event = await tokenEventOf(request, pathname)
  if (!event) return handle(request)

  const holder = await IntegrationGrantLifecycleService.findTokenHolder(
    event.token,
  )
  const response = await handle(request)

  // A refresh that worked left a live token: nothing to retire.
  const succeededRefresh = event.source === 'refresh_rejected' && response.ok
  if (!holder.ok) {
    logger.warn('integration_grant.lifecycle_lookup_failed', {
      source: event.source,
    })
  } else if (holder.value && !succeededRefresh && response.status < 500) {
    const retired =
      await IntegrationGrantLifecycleService.retireAfterTokenEvent(
        holder.value,
        event.source,
      )
    if (!retired.ok) {
      logger.warn('integration_grant.lifecycle_retire_failed', {
        source: event.source,
        clientId: holder.value.clientId,
      })
    }
  }
  return response
}
