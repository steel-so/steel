import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { requireConsent } from '@/src/lib/consent'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { ImportCrmNewsletterSubscribersSchema } from '@/src/schemas/crm-newsletter.schema'
import { CrmNewsletterSubscriberService } from '@/src/services/crm-newsletter-subscriber.service'
import { readJsonBody } from '@/utils/http-request'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = { params: Promise<{ id: string; newsletterId: string }> }

/** CSV import: the browser parses the file and posts the rows. */
export const POST = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const consent = await requireConsent(
    auth.value.user.id,
    'POST /api/workspaces/[id]/crm/newsletters/[newsletterId]/subscribers/import',
  )
  if (!consent.ok) return handleError(consent.error)

  const [{ id, newsletterId }, json] = await Promise.all([
    ctx.params,
    readJsonBody(request),
  ])
  if (!json.ok) return handleError(json.error)
  const parsed = ImportCrmNewsletterSubscribersSchema.safeParse(json.value)
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      parsed.error.issues,
    )
  }

  const result = await CrmNewsletterSubscriberService.import(
    auth.value.user.id,
    id,
    newsletterId,
    parsed.data,
  )
  if (!result.ok) return handleError(result.error)

  // Confirmation e-mails keep going after the response.
  const { background: _background, ...summary } = result.value
  return successResponse(summary)
})
