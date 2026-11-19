import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { requireConsent } from '@/src/lib/consent'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { CreatePlatformFlagSchema } from '@/src/schemas/platform-flag.schema'
import { AdminFeatureFlagService } from '@/src/services/admin-feature-flag.service'
import { readJsonBody } from '@/utils/http-request'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

/** Feature flags da plataforma. */
export const GET = withAxiom(async () => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const result = await AdminFeatureFlagService.list(auth.value.user.id)
  if (!result.ok) return handleError(result.error)
  return successResponse(result.value)
})

/** Cria uma flag (201). */
export const POST = withAxiom(async (request: NextRequest) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const consent = await requireConsent(
    auth.value.user.id,
    'POST /api/admin/feature-flags',
  )
  if (!consent.ok) return handleError(consent.error)

  const json = await readJsonBody(request, { allowEmpty: true })
  if (!json.ok) return handleError(json.error)
  const parsed = CreatePlatformFlagSchema.safeParse(json.value)
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      parsed.error.issues,
    )
  }

  const result = await AdminFeatureFlagService.create(
    auth.value.user.id,
    parsed.data,
  )
  if (!result.ok) return handleError(result.error)
  return successResponse(result.value, 201)
})
