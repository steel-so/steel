import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { AiEvalService } from '@/src/services/ai-eval.service'
import { handleError, successResponse } from '@/utils/http-response'

type Params = { params: Promise<{ id: string; setId: string; runId: string }> }

/** One run with the grade of every case. */
export const GET = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const { id, setId, runId } = await ctx.params
  const result = await AiEvalService.getRun(
    auth.value.user.id,
    id,
    setId,
    runId,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
