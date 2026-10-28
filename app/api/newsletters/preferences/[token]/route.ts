import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { getClientIp } from '@/src/lib/rate-limit-helpers'
import { UpdateNewsletterPreferencesSchema } from '@/src/schemas/crm-newsletter.schema'
import { CrmNewsletterPublicService } from '@/src/services/crm-newsletter-public.service'
import { readJsonBody } from '@/utils/http-request'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = { params: Promise<{ token: string }> }

/** Preference center of one address in one workspace (signed token). */
export const GET = withAxiom(async (request: NextRequest, ctx: Params) => {
  const limit = await consume(apiLimiter, `ip:${getClientIp(request)}`)
  if (!limit.ok) return handleError(limit.error)

  const { token } = await ctx.params
  const result = await CrmNewsletterPublicService.getPreferences(token)
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})

export const PUT = withAxiom(async (request: NextRequest, ctx: Params) => {
  const ip = getClientIp(request)
  const limit = await consume(apiLimiter, `ip:${ip}`)
  if (!limit.ok) return handleError(limit.error)

  const [{ token }, json] = await Promise.all([
    ctx.params,
    readJsonBody(request),
  ])
  if (!json.ok) return handleError(json.error)
  const parsed = UpdateNewsletterPreferencesSchema.safeParse(json.value)
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      parsed.error.issues,
    )
  }

  const result = await CrmNewsletterPublicService.updatePreferences(
    token,
    parsed.data,
    {
      ip: ip === 'unknown' ? null : ip,
      userAgent: request.headers.get('user-agent'),
      now: new Date(),
    },
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
