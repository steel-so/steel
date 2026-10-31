import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { ListAiProcedureRunsQuerySchema } from '@/src/schemas/ai-procedure.schema'
import { AiProcedureService } from '@/src/services/ai-procedure.service'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = { params: Promise<{ id: string }> }

export const GET = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const { id } = await ctx.params
  const { searchParams } = new URL(request.url)
  const query = ListAiProcedureRunsQuerySchema.safeParse({
    limit: searchParams.get('limit') || undefined,
    status: searchParams.get('status') || undefined,
  })
  if (!query.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Parâmetros inválidos',
      query.error.issues,
    )
  }

  const result = await AiProcedureService.listRuns(
    auth.value.user.id,
    id,
    null,
    query.data,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
