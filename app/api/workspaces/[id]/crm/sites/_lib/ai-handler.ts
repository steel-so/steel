import type { NextRequest } from 'next/server'
import type { ZodType } from 'zod'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { requireConsent } from '@/src/lib/consent'
import { aiMessageLimiter, consume } from '@/src/lib/rate-limit'
import type { Result } from '@/src/lib/result'
import { readJsonBody } from '@/utils/http-request'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type RouteContext<P> = { params: Promise<P> }

/**
 * Chain of the AI site-builder routes: like `siteRoute`, but every call
 * spends the AI rate limit (`aiMessageLimiter`) and needs consent, and the
 * handler may answer with its own `Response` (the generation stream).
 */
export function siteAiRoute<P, B>(
  options: { consent: string; body: ZodType<B> },
  run: (input: {
    userId: string
    params: P
    body: B
  }) => Promise<Result<unknown> | Response>,
) {
  return withAxiom(async (request: NextRequest, ctx: RouteContext<P>) => {
    const auth = await getAuthSession()
    if (!auth.ok) return handleError(auth.error)
    const userId = auth.value.user.id

    const limit = await consume(aiMessageLimiter, `user:${userId}`)
    if (!limit.ok) return handleError(limit.error)

    const consent = await requireConsent(
      userId,
      `${request.method} ${options.consent}`,
    )
    if (!consent.ok) return handleError(consent.error)

    const json = await readJsonBody(request)
    if (!json.ok) return handleError(json.error)
    const parsed = options.body.safeParse(json.value)
    if (!parsed.success) {
      return standardError(
        'VALIDATION_ERROR',
        'Dados inválidos',
        parsed.error.issues,
      )
    }

    const result = await run({
      userId,
      params: await ctx.params,
      body: parsed.data,
    })
    if (result instanceof Response) return result
    if (!result.ok) return handleError(result.error)
    return successResponse(result.value ?? null)
  })
}
