import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { WebphoneService } from '@/src/services/webphone.service'
import { handleError, successResponse } from '@/utils/http-response'

/**
 * SIP credentials of the signed-in user's own extension (browser calling).
 * Never cached: the response carries the SIP secret.
 */
export const GET = withAxiom(async () => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const result = await WebphoneService.getCredentials(auth.value.user.id)
  if (!result.ok) return handleError(result.error)

  const response = successResponse(result.value)
  response.headers.set('Cache-Control', 'no-store')
  return response
})
