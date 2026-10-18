import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { WorkspaceGrantMemberIdSchema } from '@/src/schemas/integration-grant.schema'
import { WorkspaceIntegrationGrantService } from '@/src/services/workspace-integration-grant.service'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = { params: Promise<{ id: string; userId: string }> }

/** Revokes every active grant one member holds in the workspace. */
export const DELETE = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const { id, userId } = await ctx.params
  const parsed = WorkspaceGrantMemberIdSchema.safeParse(userId)
  if (!parsed.success) {
    return standardError('VALIDATION_ERROR', 'Id inválido', parsed.error.issues)
  }

  const result = await WorkspaceIntegrationGrantService.revokeByMember(
    auth.value.user.id,
    id,
    parsed.data,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
