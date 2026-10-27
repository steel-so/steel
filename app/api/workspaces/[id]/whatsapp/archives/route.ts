import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { WhatsAppArchiveService } from '@/src/services/whatsapp-archive.service'
import { handleError, successResponse } from '@/utils/http-response'

type Params = { params: Promise<{ id: string }> }

/**
 * WhatsApp archive for banks (ADR 0052): whether it is on, the root folder
 * and the packages. OWNER/ADMIN with Comunicação enabled.
 */
export const GET = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const { id } = await ctx.params
  const result = await WhatsAppArchiveService.overview(auth.value.user.id, id)
  if (!result.ok) return handleError(result.error)
  return successResponse(result.value)
})
