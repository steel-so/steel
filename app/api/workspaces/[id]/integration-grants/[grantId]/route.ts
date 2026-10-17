import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { IntegrationGrantIdSchema } from '@/src/schemas/integration-grant.schema'
import { WorkspaceIntegrationGrantService } from '@/src/services/workspace-integration-grant.service'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = { params: Promise<{ id: string; grantId: string }> }

/** Revokes one member's grant: its tokens and consent go too, and the app's next MCP call answers 401. */
export const DELETE = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const { id, grantId } = await ctx.params
  const parsed = IntegrationGrantIdSchema.safeParse(grantId)
  if (!parsed.success) {
    return standardError('VALIDATION_ERROR', 'Id inválido', parsed.error.issues)
  }

  const result = await WorkspaceIntegrationGrantService.revoke(
    auth.value.user.id,
    id,
    parsed.data,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
