import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { CrmMeetingPublicService } from '@/src/services/crm-meeting-public.service'
import { handleError, successResponse } from '@/utils/http-response'

type Params = { params: Promise<{ token: string }> }

export const GET = withAxiom(async (request: NextRequest, ctx: Params) => {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  const limit = await consume(apiLimiter, `ip:${ip}`)
  if (!limit.ok) return handleError(limit.error)

  const { token } = await ctx.params
  const result = await CrmMeetingPublicService.getBooking(token)
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})

export const DELETE = withAxiom(async (request: NextRequest, ctx: Params) => {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  const limit = await consume(apiLimiter, `meeting-cancel:${ip}`)
  if (!limit.ok) return handleError(limit.error)

  const { token } = await ctx.params
  const result = await CrmMeetingPublicService.cancel(token)
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
