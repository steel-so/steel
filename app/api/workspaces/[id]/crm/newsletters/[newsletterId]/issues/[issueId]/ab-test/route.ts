import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { requireConsent } from '@/src/lib/consent'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { SetCrmNewsletterAbTestSchema } from '@/src/schemas/crm-newsletter-ab.schema'
import { CrmNewsletterAbService } from '@/src/services/crm-newsletter-ab.service'
import { readJsonBody } from '@/utils/http-request'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = {
  params: Promise<{ id: string; newsletterId: string; issueId: string }>
}

/** Subject A/B test settings and, once sending started, the variant stats. */
export const GET = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const { id, newsletterId, issueId } = await ctx.params
  const result = await CrmNewsletterAbService.report(
    auth.value.user.id,
    id,
    newsletterId,
    issueId,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})

/** Turns the subject A/B test on (or changes it) — DRAFT/SCHEDULED only. */
export const PUT = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const consent = await requireConsent(
    auth.value.user.id,
    'PUT /api/workspaces/[id]/crm/newsletters/[newsletterId]/issues/[issueId]/ab-test',
  )
  if (!consent.ok) return handleError(consent.error)

  const { id, newsletterId, issueId } = await ctx.params
  const json = await readJsonBody(request)
  if (!json.ok) return handleError(json.error)
  const parsed = SetCrmNewsletterAbTestSchema.safeParse(json.value)
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      parsed.error.issues,
    )
  }

  const result = await CrmNewsletterAbService.set(
    auth.value.user.id,
    id,
    newsletterId,
    issueId,
    parsed.data,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})

/** Turns the subject A/B test off — DRAFT/SCHEDULED only. */
export const DELETE = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const consent = await requireConsent(
    auth.value.user.id,
    'DELETE /api/workspaces/[id]/crm/newsletters/[newsletterId]/issues/[issueId]/ab-test',
  )
  if (!consent.ok) return handleError(consent.error)

  const { id, newsletterId, issueId } = await ctx.params
  const result = await CrmNewsletterAbService.clear(
    auth.value.user.id,
    id,
    newsletterId,
    issueId,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(null)
})
