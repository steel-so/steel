import type { NextRequest } from 'next/server'
import type { ZodType } from 'zod'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { requireConsent } from '@/src/lib/consent'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import type { Result } from '@/src/lib/result'
import { readJsonBody } from '@/utils/http-request'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type RouteContext<P> = { params: Promise<P> }

interface SiteRouteOptions<B> {
  /** Route label for the consent gate; set on every mutation. */
  consent?: string
  /** Body schema; omit for routes without a body. */
  body?: ZodType<B>
  /** Accept an empty body as `{}` (optional payloads). */
  allowEmptyBody?: boolean
  /** Success status (201 on create). */
  status?: number
}

/**
 * The fixed chain of every site-builder route (CLAUDE.md "Layered request
 * flow"): Axiom → session → rate limit → consent (mutations) → body
 * validation → service → `{ success, data }` envelope.
 */
export function siteRoute<P, B = undefined, T = unknown>(
  options: SiteRouteOptions<B>,
  run: (input: {
    userId: string
    params: P
    body: B
    request: NextRequest
  }) => Promise<Result<T>>,
) {
  return withAxiom(async (request: NextRequest, ctx: RouteContext<P>) => {
    const auth = await getAuthSession()
    if (!auth.ok) return handleError(auth.error)
    const userId = auth.value.user.id

    const limit = await consume(apiLimiter, `user:${userId}`)
    if (!limit.ok) return handleError(limit.error)

    if (options.consent) {
      const consent = await requireConsent(
        userId,
        `${request.method} ${options.consent}`,
      )
      if (!consent.ok) return handleError(consent.error)
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

    const params = await ctx.params
    const result = await run({ userId, params, body, request })
    if (!result.ok) return handleError(result.error)
    return successResponse(result.value ?? null, options.status ?? 200)
  })
}
