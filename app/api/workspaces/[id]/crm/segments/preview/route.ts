import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { PreviewCrmSegmentSchema } from '@/src/schemas/crm-segment.schema'
import { CrmSegmentService } from '@/src/services/crm-segment.service'
import { readJsonBody } from '@/utils/http-request'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = { params: Promise<{ id: string }> }

/** Live count and sample of rules that may not be saved yet (read-only). */
export const POST = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const { id } = await ctx.params
  const json = await readJsonBody(request)
  if (!json.ok) return handleError(json.error)
  const parsed = PreviewCrmSegmentSchema.safeParse(json.value)
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      parsed.error.issues[0]?.message ?? 'Dados inválidos',
      parsed.error.issues,
    )
  }

  const result = await CrmSegmentService.preview(
    auth.value.user.id,
    id,
    parsed.data,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
