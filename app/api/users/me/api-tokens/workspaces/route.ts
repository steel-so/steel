import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { ApiTokenService } from '@/src/services/api-token.service'
import { handleError, successResponse } from '@/utils/http-response'

/** Workspaces (and their enabled modules) a new token may be created for. */
export const GET = withAxiom(async () => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const result = await ApiTokenService.listGrantableWorkspaces(
    auth.value.user.id,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
