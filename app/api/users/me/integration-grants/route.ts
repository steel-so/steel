import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { IntegrationGrantService } from '@/src/services/integration-grant.service'
import { handleError, successResponse } from '@/utils/http-response'

/**
 * "Apps conectados" of the signed-in user: the active OAuth grants (MCP
 * clients) with their workspace, scopes and modules (ADR 0033).
 */
export const GET = withAxiom(async () => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const result = await IntegrationGrantService.listForUser(auth.value.user.id)
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
