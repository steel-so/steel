import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { PlatformZapiLineService } from '@/src/services/platform-zapi-line.service'
import { handleError, successResponse } from '@/utils/http-response'

/** Live status of the platform line (the admin screen polls it). */
export const GET = withAxiom(async (_request: NextRequest) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const result = await PlatformZapiLineService.refreshStatus(auth.value.user.id)
  if (!result.ok) return handleError(result.error)
  return successResponse(result.value)
})
