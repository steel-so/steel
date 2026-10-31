import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { BookCrmMeetingSchema } from '@/src/schemas/crm-meeting.schema'
import { CrmMeetingPublicService } from '@/src/services/crm-meeting-public.service'
import { readJsonBody } from '@/utils/http-request'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = { params: Promise<{ slug: string }> }

export const POST = withAxiom(async (request: NextRequest, ctx: Params) => {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  const limit = await consume(apiLimiter, `meeting-book:${ip}`)
  if (!limit.ok) return handleError(limit.error)

  const { slug } = await ctx.params
  const json = await readJsonBody(request)
  if (!json.ok) return handleError(json.error)
  const parsed = BookCrmMeetingSchema.safeParse(json.value)
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      parsed.error.issues,
    )
  }

  const result = await CrmMeetingPublicService.book(slug, parsed.data)
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value, 201)
})
