import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { requireConsent } from '@/src/lib/consent'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { CrmSegmentService } from '@/src/services/crm-segment.service'
import { handleError, successResponse } from '@/utils/http-response'

type Params = { params: Promise<{ id: string; segmentId: string }> }

/** Copies a segment (name "<nome> (cópia)"). */
export const POST = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const consent = await requireConsent(
    auth.value.user.id,
    'POST /api/workspaces/[id]/crm/segments/[segmentId]/duplicate',
  )
  if (!consent.ok) return handleError(consent.error)

  const { id, segmentId } = await ctx.params
  const result = await CrmSegmentService.duplicate(
    auth.value.user.id,
    id,
    segmentId,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value, 201)
})
