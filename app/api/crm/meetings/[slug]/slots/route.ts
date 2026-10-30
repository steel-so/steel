import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { PublicSlotsQuerySchema } from '@/src/schemas/crm-meeting.schema'
import { CrmMeetingPublicService } from '@/src/services/crm-meeting-public.service'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = { params: Promise<{ slug: string }> }

export const GET = withAxiom(async (request: NextRequest, ctx: Params) => {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  const limit = await consume(apiLimiter, `ip:${ip}`)
  if (!limit.ok) return handleError(limit.error)

  const { slug } = await ctx.params
  const { searchParams } = new URL(request.url)
  const parsed = PublicSlotsQuerySchema.safeParse({
    from: searchParams.get('from') ?? undefined,
    days: searchParams.get('days') ?? undefined,
  })
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Parâmetros inválidos',
      parsed.error.issues,
    )
  }

  const result = await CrmMeetingPublicService.listSlots(slug, parsed.data)
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
