import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { requireConsent } from '@/src/lib/consent'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { WikiPageService } from '@/src/services/wiki-page.service'
import { handleError, successResponse } from '@/utils/http-response'

type Params = { params: Promise<{ id: string; wikiPageId: string }> }

function handler(locked: boolean) {
  const method = locked ? 'POST' : 'DELETE'
  return withAxiom(async (_request: NextRequest, ctx: Params) => {
    const auth = await getAuthSession()
    if (!auth.ok) return handleError(auth.error)

    const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
    if (!limit.ok) return handleError(limit.error)

    const consent = await requireConsent(
      auth.value.user.id,
      `${method} /api/workspaces/[id]/wiki/[wikiPageId]/lock`,
    )
    if (!consent.ok) return handleError(consent.error)

    const { id, wikiPageId } = await ctx.params

    const result = await WikiPageService.setLock(
      auth.value.user.id,
      id,
      wikiPageId,
      locked,
    )
    if (!result.ok) return handleError(result.error)

    return successResponse(result.value)
  })
}

/** Locks editing (author or OWNER/ADMIN). */
export const POST = handler(true)

/** Unlocks editing (author or OWNER/ADMIN). */
export const DELETE = handler(false)
