import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { requireConsent } from '@/src/lib/consent'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { OAuthConsentSchema } from '@/src/schemas/integration-grant.schema'
import { IntegrationGrantService } from '@/src/services/integration-grant.service'
import { readJsonBody } from '@/utils/http-request'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

/**
 * Answer of the OAuth consent page (`/oauth/consent`, ADR 0033).
 *
 * The body carries the signed query the provider redirected with, plus the
 * workspace, modules and scopes the user picked. The service stores the
 * grant and asks the provider for the authorization code; the response is
 * the client's `redirect_uri` (with `code`, or `error=access_denied`), which
 * the page then navigates to.
 */
export const POST = withAxiom(async (request: NextRequest) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const consent = await requireConsent(
    auth.value.user.id,
    'POST /api/oauth/consent',
  )
  if (!consent.ok) return handleError(consent.error)

  const json = await readJsonBody(request)
  if (!json.ok) return handleError(json.error)

  const parsed = OAuthConsentSchema.safeParse(json.value)
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      parsed.error.issues,
    )
  }

  const result = await IntegrationGrantService.consent(
    auth.value.user.id,
    parsed.data,
    request.headers,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
