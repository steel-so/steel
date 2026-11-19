import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { requireConsent } from '@/src/lib/consent'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { SetFlagWorkspaceSchema } from '@/src/schemas/platform-flag.schema'
import { AdminFeatureFlagService } from '@/src/services/admin-feature-flag.service'
import { readJsonBody } from '@/utils/http-request'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = { params: Promise<{ id: string }> }

/** Libera (`granted: true`) ou revoga a flag para um workspace. */
export const PUT = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const consent = await requireConsent(
    auth.value.user.id,
    'PUT /api/admin/feature-flags/[id]/workspaces',
  )
  if (!consent.ok) return handleError(consent.error)

  const [{ id }, json] = await Promise.all([
    ctx.params,
    readJsonBody(request, { allowEmpty: true }),
  ])
  if (!json.ok) return handleError(json.error)
  const parsed = SetFlagWorkspaceSchema.safeParse(json.value)
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      parsed.error.issues,
    )
  }

  const result = await AdminFeatureFlagService.setWorkspaceGrant(
    auth.value.user.id,
    id,
    parsed.data,
  )
  if (!result.ok) return handleError(result.error)
  return successResponse(result.value)
})
