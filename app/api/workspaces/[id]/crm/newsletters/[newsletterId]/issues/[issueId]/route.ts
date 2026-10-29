import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { requireConsent } from '@/src/lib/consent'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { UpdateCrmNewsletterIssueSchema } from '@/src/schemas/crm-newsletter-issue.schema'
import { CrmNewsletterIssueService } from '@/src/services/crm-newsletter-issue.service'
import { readJsonBody } from '@/utils/http-request'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = {
  params: Promise<{ id: string; newsletterId: string; issueId: string }>
}

/** Issue detail, with the canvas `builderDocument`. */
export const GET = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const { id, newsletterId, issueId } = await ctx.params
  const result = await CrmNewsletterIssueService.get(
    auth.value.user.id,
    id,
    newsletterId,
    issueId,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})

/** Editor autosave (DRAFT/SCHEDULED only). */
export const PATCH = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const consent = await requireConsent(
    auth.value.user.id,
    'PATCH /api/workspaces/[id]/crm/newsletters/[newsletterId]/issues/[issueId]',
  )
  if (!consent.ok) return handleError(consent.error)

  const { id, newsletterId, issueId } = await ctx.params
  const json = await readJsonBody(request)
  if (!json.ok) return handleError(json.error)
  const parsed = UpdateCrmNewsletterIssueSchema.safeParse(json.value)
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      parsed.error.issues,
    )
  }

  const result = await CrmNewsletterIssueService.update(
    auth.value.user.id,
    id,
    newsletterId,
    issueId,
    parsed.data,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})

/** Deletes a draft. */
export const DELETE = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const consent = await requireConsent(
    auth.value.user.id,
    'DELETE /api/workspaces/[id]/crm/newsletters/[newsletterId]/issues/[issueId]',
  )
  if (!consent.ok) return handleError(consent.error)

  const { id, newsletterId, issueId } = await ctx.params
  const result = await CrmNewsletterIssueService.remove(
    auth.value.user.id,
    id,
    newsletterId,
    issueId,
    new Date(),
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(null)
})
