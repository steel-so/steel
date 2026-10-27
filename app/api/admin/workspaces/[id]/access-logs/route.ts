import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { WorkspaceAccessLogListQuerySchema } from '@/src/schemas/workspace-access-log.schema'
import { WorkspaceAccessLogService } from '@/src/services/workspace-access-log.service'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = { params: Promise<{ id: string }> }

/** Admin workspace panel: entry log of the IP-restricted workspace (global admin) */
export const GET = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const query = WorkspaceAccessLogListQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  )
  if (!query.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Parâmetros inválidos',
      query.error.issues,
    )
  }

  const { id } = await ctx.params
  const result = await WorkspaceAccessLogService.adminList(
    auth.value.user.id,
    id,
    query.data,
  )
  if (!result.ok) return handleError(result.error)
  return successResponse(result.value)
})
