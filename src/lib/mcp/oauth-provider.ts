import 'server-only'
import { logger } from '@/lib/axiom/logger'
import { oauthRequestInvalid } from '@/src/errors'
import type { AppError } from '@/src/errors/app-error'
import { auth } from '@/src/lib/auth'
import { runWithGrantReference } from '@/src/lib/mcp/consent-reference'
import { oauthIssuer } from '@/src/lib/mcp/oauth-config'
import { err, ok, type Result } from '@/src/lib/result'

/**
 * Thin seam over the oauth-provider plugin, so the consent service can be
 * unit-tested without Better Auth. The plugin checks the signature and the
 * expiry of `oauthQuery`, stores the consent and issues the code.
 */

function redirectUrlOf(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const url = record.url ?? record.redirect_uri
  return typeof url === 'string' && url.length > 0 ? url : null
}

/** What the provider needs from the browser request: session and origin. */
const FORWARDED_HEADERS = [
  'cookie',
  'origin',
  'referer',
  'user-agent',
  'x-forwarded-for',
  'x-real-ip',
] as const

export const OAuthProviderGateway = {
  /**
   * Answers the consent prompt. With `accept: true` the plugin runs inside
   * the grant's reference, so the code and the tokens point to it.
   */
  async consent(input: {
    headers: Headers
    oauthQuery: string
    accept: boolean
    /** Space-separated scopes the user accepted. */
    scope?: string
    grantId?: string
  }): Promise<Result<{ redirectUrl: string }, AppError>> {
    // Through the handler, not `auth.api`: the plugin's authorize step needs
    // a real `Request`, and this keeps the session, origin and CSRF checks
    // exactly as a browser call would get them.
    const headers = new Headers({
      'content-type': 'application/json',
      accept: 'application/json',
    })
    for (const name of FORWARDED_HEADERS) {
      const value = input.headers.get(name)
      if (value) headers.set(name, value)
    }
    const call = async () => {
      const response = await auth.handler(
        new Request(`${oauthIssuer()}/oauth2/consent`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            accept: input.accept,
            oauth_query: input.oauthQuery,
            ...(input.scope ? { scope: input.scope } : {}),
          }),
        }),
      )
      const body = (await response.json().catch(() => null)) as unknown
      if (!response.ok) {
        throw new Error(
          `consent answered ${response.status}: ${JSON.stringify(body)}`,
        )
      }
      return body
    }

    try {
      const response = input.grantId
        ? await runWithGrantReference(input.grantId, call)
        : await call()
      const redirectUrl = redirectUrlOf(response)
      if (!redirectUrl) {
        logger.warn('oauth.consent.no_redirect', { accept: input.accept })
        return err(oauthRequestInvalid())
      }
      return ok({ redirectUrl })
    } catch (error) {
      logger.warn('oauth.consent.rejected', {
        accept: input.accept,
        message: error instanceof Error ? error.message : String(error),
      })
      return err(oauthRequestInvalid())
    }
  },
}
