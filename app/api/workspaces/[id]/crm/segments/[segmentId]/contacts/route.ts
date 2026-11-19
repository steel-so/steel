import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { ListCrmSegmentContactsSchema } from '@/src/schemas/crm-segment.schema'
import { CrmSegmentService } from '@/src/services/crm-segment.service'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = { params: Promise<{ id: string; segmentId: string }> }

/** Members of the segment right now, paginated. */
export const GET = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const { id, segmentId } = await ctx.params
  const { searchParams } = new URL(request.url)
  const parsed = ListCrmSegmentContactsSchema.safeParse({
    page: searchParams.get('page') ?? undefined,
    pageSize: searchParams.get('pageSize') ?? undefined,
  })
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Parâmetros inválidos',
      parsed.error.issues,
    )
  }

  const result = await CrmSegmentService.contacts(
    auth.value.user.id,
    id,
    segmentId,
    parsed.data.page,
    parsed.data.pageSize,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
