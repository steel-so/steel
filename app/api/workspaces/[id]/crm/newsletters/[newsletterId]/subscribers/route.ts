import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { requireConsent } from '@/src/lib/consent'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import {
  AddCrmNewsletterSubscriberSchema,
  ListCrmNewsletterSubscribersQuerySchema,
} from '@/src/schemas/crm-newsletter.schema'
import { CrmNewsletterSubscriberService } from '@/src/services/crm-newsletter-subscriber.service'
import { readJsonBody } from '@/utils/http-request'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = { params: Promise<{ id: string; newsletterId: string }> }

export const GET = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const { id, newsletterId } = await ctx.params
  const params = request.nextUrl.searchParams
  const parsed = ListCrmNewsletterSubscribersQuerySchema.safeParse({
    page: params.get('page') ?? undefined,
    pageSize: params.get('pageSize') ?? undefined,
    search: params.get('search') || undefined,
    status: params.get('status') || undefined,
    source: params.get('source') || undefined,
  })
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Parâmetros inválidos',
      parsed.error.issues,
    )
  }

  const result = await CrmNewsletterSubscriberService.list(
    auth.value.user.id,
    id,
    newsletterId,
    parsed.data,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})

export const POST = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const consent = await requireConsent(
    auth.value.user.id,
    'POST /api/workspaces/[id]/crm/newsletters/[newsletterId]/subscribers',
  )
  if (!consent.ok) return handleError(consent.error)

  const [{ id, newsletterId }, json] = await Promise.all([
    ctx.params,
    readJsonBody(request),
  ])
  if (!json.ok) return handleError(json.error)
  const parsed = AddCrmNewsletterSubscriberSchema.safeParse(json.value)
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      parsed.error.issues,
    )
  }

  const result = await CrmNewsletterSubscriberService.add(
    auth.value.user.id,
    id,
    newsletterId,
    parsed.data,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value, 201)
})
