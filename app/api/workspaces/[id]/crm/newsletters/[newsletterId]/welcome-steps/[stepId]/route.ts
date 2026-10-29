import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { requireConsent } from '@/src/lib/consent'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { UpdateCrmNewsletterWelcomeStepSchema } from '@/src/schemas/crm-newsletter-automation.schema'
import { CrmNewsletterWelcomeService } from '@/src/services/crm-newsletter-welcome.service'
import { readJsonBody } from '@/utils/http-request'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = {
  params: Promise<{ id: string; newsletterId: string; stepId: string }>
}

/** Step detail, with the canvas `builderDocument`. */
export const GET = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const { id, newsletterId, stepId } = await ctx.params
  const result = await CrmNewsletterWelcomeService.get(
    auth.value.user.id,
    id,
    newsletterId,
    stepId,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})

/** Editor autosave and the list controls (switch, delay). */
export const PATCH = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const consent = await requireConsent(
    auth.value.user.id,
    'PATCH /api/workspaces/[id]/crm/newsletters/[newsletterId]/welcome-steps/[stepId]',
  )
  if (!consent.ok) return handleError(consent.error)

  const { id, newsletterId, stepId } = await ctx.params
  const json = await readJsonBody(request)
  if (!json.ok) return handleError(json.error)
  const parsed = UpdateCrmNewsletterWelcomeStepSchema.safeParse(json.value)
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      parsed.error.issues,
    )
  }

  const result = await CrmNewsletterWelcomeService.update(
    auth.value.user.id,
    id,
    newsletterId,
    stepId,
    parsed.data,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})

/** Removes the step (its progress rows go with it). */
export const DELETE = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const consent = await requireConsent(
    auth.value.user.id,
    'DELETE /api/workspaces/[id]/crm/newsletters/[newsletterId]/welcome-steps/[stepId]',
  )
  if (!consent.ok) return handleError(consent.error)

  const { id, newsletterId, stepId } = await ctx.params
  const result = await CrmNewsletterWelcomeService.remove(
    auth.value.user.id,
    id,
    newsletterId,
    stepId,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(null)
})
