import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { AiEvalLatestQuerySchema } from '@/src/schemas/ai-eval.schema'
import { AiEvalService } from '@/src/services/ai-eval.service'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = { params: Promise<{ id: string }> }

/** Last finished run of every set of a target ("rodar avaliação antes de trocar"). */
export const GET = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const parsed = AiEvalLatestQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  )
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Parâmetros inválidos',
      parsed.error.issues,
    )
  }

  const { id } = await ctx.params
  const result = await AiEvalService.latest(
    auth.value.user.id,
    id,
    parsed.data.target,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
