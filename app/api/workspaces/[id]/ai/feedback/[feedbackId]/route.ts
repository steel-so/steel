import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { requireConsent } from '@/src/lib/consent'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { AiFeedbackService } from '@/src/services/ai-feedback.service'
import { handleError, successResponse } from '@/utils/http-response'

type Params = { params: Promise<{ id: string; feedbackId: string }> }

/** Removes the caller's own rating (undo). */
export const DELETE = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const consent = await requireConsent(
    auth.value.user.id,
    'DELETE /api/workspaces/[id]/ai/feedback/[feedbackId]',
  )
  if (!consent.ok) return handleError(consent.error)

  const { id, feedbackId } = await ctx.params
  const result = await AiFeedbackService.remove(
    auth.value.user.id,
    id,
    feedbackId,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
