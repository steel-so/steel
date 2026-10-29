import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { requireConsent } from '@/src/lib/consent'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { SubscribeCrmPersonNewsletterSchema } from '@/src/schemas/crm-newsletter-bridge.schema'
import { CrmNewsletterPersonService } from '@/src/services/crm-newsletter-person.service'
import { readJsonBody } from '@/utils/http-request'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = { params: Promise<{ id: string; personId: string }> }

/** Newsletter subscriptions of the CRM person (card on the person page). */
export const GET = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const { id, personId } = await ctx.params
  const result = await CrmNewsletterPersonService.get(
    auth.value.user.id,
    id,
    personId,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})

/** Subscribes the person to a newsletter (member vouches for consent). */
export const POST = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const consent = await requireConsent(
    auth.value.user.id,
    'POST /api/workspaces/[id]/crm/people/[personId]/newsletters',
  )
  if (!consent.ok) return handleError(consent.error)

  const [{ id, personId }, json] = await Promise.all([
    ctx.params,
    readJsonBody(request),
  ])
  if (!json.ok) return handleError(json.error)
  const parsed = SubscribeCrmPersonNewsletterSchema.safeParse(json.value)
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      parsed.error.issues,
    )
  }

  const result = await CrmNewsletterPersonService.subscribe(
    auth.value.user.id,
    id,
    personId,
    parsed.data,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value, 201)
})
