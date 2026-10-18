import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { resolveApiSession } from '@/src/lib/api/session'
import { ApiTokenService } from '@/src/services/api-token.service'
import { handleError } from '@/utils/http-response'

/**
 * `steel logout`: revokes the personal token this request carries
 * (`Authorization: Bearer stl_pat_...`). `204` on success; the token answers
 * 401 from then on.
 */
export const DELETE = withAxiom(async (request: NextRequest) => {
  const session = await resolveApiSession(request)
  if (!session.ok) return handleError(session.error)

  const result = await ApiTokenService.revokeCurrent(session.value)
  if (!result.ok) return handleError(result.error)

  return new Response(null, { status: 204 })
})
