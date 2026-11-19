import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { requireConsent } from '@/src/lib/consent'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { UpdatePlatformFlagSchema } from '@/src/schemas/platform-flag.schema'
import { AdminFeatureFlagService } from '@/src/services/admin-feature-flag.service'
import { readJsonBody } from '@/utils/http-request'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = { params: Promise<{ id: string }> }

/** Edita nome, descrição, estado global e beta de uma flag. */
export const PATCH = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const consent = await requireConsent(
    auth.value.user.id,
    'PATCH /api/admin/feature-flags/[id]',
  )
  if (!consent.ok) return handleError(consent.error)

  const [{ id }, json] = await Promise.all([
    ctx.params,
    readJsonBody(request, { allowEmpty: true }),
  ])
  if (!json.ok) return handleError(json.error)
  const parsed = UpdatePlatformFlagSchema.safeParse(json.value)
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      parsed.error.issues,
    )
  }

  const result = await AdminFeatureFlagService.update(
    auth.value.user.id,
    id,
    parsed.data,
  )
  if (!result.ok) return handleError(result.error)
  return successResponse(result.value)
})

export const DELETE = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const consent = await requireConsent(
    auth.value.user.id,
    'DELETE /api/admin/feature-flags/[id]',
  )
  if (!consent.ok) return handleError(consent.error)

  const { id } = await ctx.params
  const result = await AdminFeatureFlagService.remove(auth.value.user.id, id)
  if (!result.ok) return handleError(result.error)
  return successResponse(result.value)
})
