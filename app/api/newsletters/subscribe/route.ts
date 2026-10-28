import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import {
  consume,
  newsletterSubscribeEmailLimiter,
  newsletterSubscribeIpLimiter,
} from '@/src/lib/rate-limit'
import { getClientIp } from '@/src/lib/rate-limit-helpers'
import {
  type PublicNewsletterSubscribeResultDTO,
  PublicNewsletterSubscribeSchema,
} from '@/src/schemas/crm-newsletter.schema'
import { CrmNewsletterPublicService } from '@/src/services/crm-newsletter-public.service'
import { readJsonBody } from '@/utils/http-request'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

/** Any site may embed the subscribe form (no cookies are involved). */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
}

function withCors(response: Response): Response {
  for (const [key, value] of Object.entries(CORS)) {
    response.headers.set(key, value)
  }
  return response
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

/**
 * Public subscribe (ADR 0054): archive page, Sites element, external sites.
 * No session; rate limited per IP and per e-mail. The answer is the same
 * whatever the state of the address, so nothing about it leaks.
 */
export const POST = withAxiom(async (request: NextRequest) => {
  const ip = getClientIp(request)
  const byIp = await consume(newsletterSubscribeIpLimiter, `ip:${ip}`)
  if (!byIp.ok) return withCors(handleError(byIp.error))

  const json = await readJsonBody(request)
  if (!json.ok) return withCors(handleError(json.error))

  // Honeypot filled by a bot: pretend it worked and do nothing.
  const website = (json.value as { website?: unknown } | null)?.website
  if (typeof website === 'string' && website.length > 0) {
    const fake: PublicNewsletterSubscribeResultDTO = {
      requiresConfirmation: true,
    }
    return withCors(successResponse(fake))
  }

  const parsed = PublicNewsletterSubscribeSchema.safeParse(json.value)
  if (!parsed.success) {
    return withCors(
      standardError('VALIDATION_ERROR', 'Dados inválidos', parsed.error.issues),
    )
  }

  const byEmail = await consume(
    newsletterSubscribeEmailLimiter,
    `email:${parsed.data.email.toLowerCase()}`,
  )
  if (!byEmail.ok) return withCors(handleError(byEmail.error))

  const result = await CrmNewsletterPublicService.subscribe(parsed.data, {
    ip: ip === 'unknown' ? null : ip,
    userAgent: request.headers.get('user-agent'),
    now: new Date(),
  })
  if (!result.ok) return withCors(handleError(result.error))

  return withCors(successResponse(result.value))
})
