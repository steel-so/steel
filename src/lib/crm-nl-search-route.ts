import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { aiMessageLimiter, consume } from '@/src/lib/rate-limit'
import type { Result } from '@/src/lib/result'
import {
  type CrmNlSearchDTO,
  CrmNlSearchSchema,
} from '@/src/schemas/crm-nl-search.schema'
import { readJsonBody } from '@/utils/http-request'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = { params: Promise<{ id: string }> }

/**
 * `POST` handler of a natural-language search route (C10): session, the AI
 * message rate limit, the `{ query }` body, then the entity's service call.
 * Authorization (module access, feature flag, quota) lives in the service.
 */
export function crmNlSearchRoute(
  search: (
    actorId: string,
    workspaceId: string,
    dto: CrmNlSearchDTO,
  ) => Promise<Result<unknown>>,
) {
  return withAxiom(async (request: NextRequest, ctx: Params) => {
    const auth = await getAuthSession()
    if (!auth.ok) return handleError(auth.error)

    const limit = await consume(aiMessageLimiter, `user:${auth.value.user.id}`)
    if (!limit.ok) return handleError(limit.error)

    const { id } = await ctx.params
    const json = await readJsonBody(request)
    if (!json.ok) return handleError(json.error)
    const parsed = CrmNlSearchSchema.safeParse(json.value)
    if (!parsed.success) {
      return standardError(
        'VALIDATION_ERROR',
        'Dados inválidos',
        parsed.error.issues,
      )
    }

    const result = await search(auth.value.user.id, id, parsed.data)
    if (!result.ok) return handleError(result.error)
    return successResponse(result.value)
  })
}
