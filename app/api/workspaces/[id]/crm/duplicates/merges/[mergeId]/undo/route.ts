import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { requireConsent } from '@/src/lib/consent'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { CrmDuplicateService } from '@/src/services/crm-duplicate.service'
import { handleError, successResponse } from '@/utils/http-response'

type Params = { params: Promise<{ id: string; mergeId: string }> }

export const POST = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const consent = await requireConsent(
    auth.value.user.id,
    'POST /api/workspaces/[id]/crm/duplicates/merges/[mergeId]/undo',
  )
  if (!consent.ok) return handleError(consent.error)

  const { id, mergeId } = await ctx.params
  const result = await CrmDuplicateService.undo(auth.value.user.id, id, mergeId)
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
