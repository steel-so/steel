import { type NextRequest, NextResponse } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { getClientIp } from '@/src/lib/rate-limit-helpers'
import { NewsletterUnsubscribeSchema } from '@/src/schemas/crm-newsletter.schema'
import { CrmNewsletterPublicService } from '@/src/services/crm-newsletter-public.service'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = { params: Promise<{ token: string }> }

/**
 * Leaves one newsletter (ADR 0054). No session: the signed token is the
 * authorization (route in PUBLIC_ROUTES).
 *
 * - `POST` with the form-urlencoded body `List-Unsubscribe=One-Click`: the
 *   RFC 8058 one-click sent by the mailbox provider.
 * - `POST` with JSON `{ reason? }`: the confirm button of
 *   `/newsletter/sair/<token>`.
 * - `GET`: redirects to that page; never unsubscribes on GET (link scanners).
 */
export const GET = withAxiom(async (request: NextRequest, ctx: Params) => {
  const { token } = await ctx.params
  return NextResponse.redirect(
    new URL(`/newsletter/sair/${encodeURIComponent(token)}`, request.url),
    303,
  )
})

export const POST = withAxiom(async (request: NextRequest, ctx: Params) => {
  const limit = await consume(apiLimiter, `ip:${getClientIp(request)}`)
  if (!limit.ok) return handleError(limit.error)

  const { token } = await ctx.params
  const body = await request.text().catch(() => '')
  const oneClick =
    new URLSearchParams(body).get('List-Unsubscribe') === 'One-Click'

  let reason: string | undefined
  if (!oneClick && body.trim()) {
    let json: unknown
    try {
      json = JSON.parse(body)
    } catch {
      json = {}
    }
    const parsed = NewsletterUnsubscribeSchema.safeParse(json)
    if (!parsed.success) {
      return standardError(
        'VALIDATION_ERROR',
        'Dados inválidos',
        parsed.error.issues,
      )
    }
    reason = parsed.data.reason
  }

  const result = await CrmNewsletterPublicService.unsubscribe(
    token,
    { reason, oneClick },
    new Date(),
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
