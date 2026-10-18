import type { NextRequest } from 'next/server'
import type { z } from 'zod'
import { withAxiom } from '@/lib/axiom/server'
import { type AppError, apiTokenScopeRequired } from '@/src/errors/app-error'
import { type ApiSession, resolveApiSession } from '@/src/lib/api/session'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { err, ok, type Result } from '@/src/lib/result'
import { readJsonBody } from '@/utils/http-request'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

/**
 * Handler of the `/api/v1/webhooks/**` routes (ADR 0035/0036): personal
 * token (`resolveApiSession`, never the cookie) → `api:write` for changes
 * (`API_TOKEN_SCOPE_REQUIRED`, as every other v1 route) →
 * rate limit per token → Zod (query/body) → service → envelope. Authorization
 * (OWNER/ADMIN) lives in `WebhookService`, with the token owner as actor.
 */

type RouteParams = Record<string, string>

export interface WebhookV1HandlerInput<B, Q> {
  session: ApiSession
  params: RouteParams
  body: B
  query: Q
}

interface WebhookV1RouteOptions<B, Q> {
  /** Changes need the `api:write` scope. */
  write?: boolean
  body?: z.ZodType<B>
  allowEmptyBody?: boolean
  query?: z.ZodType<Q>
  status?: number
  handler: (input: WebhookV1HandlerInput<B, Q>) => Promise<Result<unknown>>
}

/** Token + scope + per-token rate limit, shared with the SSE route. */
export async function authorizeWebhookV1(
  request: Request,
  options: { write?: boolean } = {},
): Promise<Result<ApiSession, AppError>> {
  const session = await resolveApiSession(request)
  if (!session.ok) return session
  if (options.write && !session.value.scopes.includes('api:write')) {
    return err(apiTokenScopeRequired('api:write'))
  }
  const limit = await consume(apiLimiter, `api-token:${session.value.tokenId}`)
  if (!limit.ok) return limit
  return ok(session.value)
}

function queryObject(url: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of new URL(url).searchParams) out[key] = value
  return out
}

export function webhookV1Route<B = undefined, Q = undefined>(
  options: WebhookV1RouteOptions<B, Q>,
) {
  return withAxiom(
    async (request: NextRequest, ctx: { params: Promise<RouteParams> }) => {
      const session = await authorizeWebhookV1(request, {
        write: options.write,
      })
      if (!session.ok) return handleError(session.error)

      const params = await ctx.params

      let query = undefined as Q
      if (options.query) {
        const parsed = options.query.safeParse(queryObject(request.url))
        if (!parsed.success) {
          return standardError(
            'VALIDATION_ERROR',
            'Parâmetros inválidos',
            parsed.error.issues,
          )
        }
        query = parsed.data
      }

      let body = undefined as B
      if (options.body) {
        const json = await readJsonBody(request, {
          allowEmpty: options.allowEmptyBody,
        })
        if (!json.ok) return handleError(json.error)
        const parsed = options.body.safeParse(json.value)
        if (!parsed.success) {
          return standardError(
            'VALIDATION_ERROR',
            'Dados inválidos',
            parsed.error.issues,
          )
        }
        body = parsed.data
      }

      const result = await options.handler({
        session: session.value,
        params,
        body,
        query,
      })
      if (!result.ok) return handleError(result.error)
      return successResponse(result.value ?? null, options.status ?? 200)
    },
  )
}

/** Call context of a token for `WebhookService`. */
export function webhookApiContext(session: ApiSession) {
  return { source: 'api' as const, modules: session.modules }
}
