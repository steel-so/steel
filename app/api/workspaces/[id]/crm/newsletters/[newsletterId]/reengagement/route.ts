import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { requireConsent } from '@/src/lib/consent'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { UpdateCrmNewsletterReengagementSchema } from '@/src/schemas/crm-newsletter-automation.schema'
import { CrmNewsletterReengagementService } from '@/src/services/crm-newsletter-reengagement.service'
import { readJsonBody } from '@/utils/http-request'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = {
  params: Promise<{ id: string; newsletterId: string }>
}

/** Re-engagement settings (defaults when never saved), preview and totals. */
export const GET = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const { id, newsletterId } = await ctx.params
  const result = await CrmNewsletterReengagementService.get(
    auth.value.user.id,
    id,
    newsletterId,
    new Date(),
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})

/** Saves the re-engagement settings (audited: the rule can unsubscribe). */
export const PUT = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const consent = await requireConsent(
    auth.value.user.id,
    'PUT /api/workspaces/[id]/crm/newsletters/[newsletterId]/reengagement',
  )
  if (!consent.ok) return handleError(consent.error)

  const { id, newsletterId } = await ctx.params
  const json = await readJsonBody(request)
  if (!json.ok) return handleError(json.error)
  const parsed = UpdateCrmNewsletterReengagementSchema.safeParse(json.value)
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      parsed.error.issues,
    )
  }

  const result = await CrmNewsletterReengagementService.update(
    auth.value.user.id,
    id,
    newsletterId,
    parsed.data,
    new Date(),
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
