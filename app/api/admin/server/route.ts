import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { AdminServerService } from '@/src/services/admin-server.service'
import { handleError, successResponse } from '@/utils/http-response'

/** Host, containers, Postgres and Redis health (platform admin only). */
export const GET = withAxiom(async (_request: NextRequest) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const result = await AdminServerService.getSnapshot(auth.value.user.id)
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
