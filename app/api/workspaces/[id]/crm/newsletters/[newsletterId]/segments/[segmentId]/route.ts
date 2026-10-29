import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { requireConsent } from '@/src/lib/consent'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { UpdateCrmNewsletterSegmentSchema } from '@/src/schemas/crm-newsletter-segment.schema'
import { CrmNewsletterSegmentService } from '@/src/services/crm-newsletter-segment.service'
import { readJsonBody } from '@/utils/http-request'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = {
  params: Promise<{ id: string; newsletterId: string; segmentId: string }>
}

/** Renames a saved segment or replaces its conditions. */
export const PATCH = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const consent = await requireConsent(
    auth.value.user.id,
    'PATCH /api/workspaces/[id]/crm/newsletters/[newsletterId]/segments/[segmentId]',
  )
  if (!consent.ok) return handleError(consent.error)

  const { id, newsletterId, segmentId } = await ctx.params
  const json = await readJsonBody(request)
  if (!json.ok) return handleError(json.error)
  const parsed = UpdateCrmNewsletterSegmentSchema.safeParse(json.value)
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      parsed.error.issues,
    )
  }

  const result = await CrmNewsletterSegmentService.update(
    auth.value.user.id,
    id,
    newsletterId,
    segmentId,
    parsed.data,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})

/** Deletes a saved segment (issues keep their copy of the conditions). */
export const DELETE = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const consent = await requireConsent(
    auth.value.user.id,
    'DELETE /api/workspaces/[id]/crm/newsletters/[newsletterId]/segments/[segmentId]',
  )
  if (!consent.ok) return handleError(consent.error)

  const { id, newsletterId, segmentId } = await ctx.params
  const result = await CrmNewsletterSegmentService.remove(
    auth.value.user.id,
    id,
    newsletterId,
    segmentId,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(null)
})
