import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { requireConsent } from '@/src/lib/consent'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import {
  ListFlagWorkspacesQuerySchema,
  SetWorkspaceBetaSchema,
} from '@/src/schemas/platform-flag.schema'
import { AdminFeatureFlagService } from '@/src/services/admin-feature-flag.service'
import { readJsonBody } from '@/utils/http-request'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

/** Workspaces (beta primeiro) com busca `?search=` e `?flagId=` opcional. */
export const GET = withAxiom(async (request: NextRequest) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const parsed = ListFlagWorkspacesQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  )
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Filtros inválidos',
      parsed.error.issues,
    )
  }

  const result = await AdminFeatureFlagService.listWorkspaces(
    auth.value.user.id,
    parsed.data,
  )
  if (!result.ok) return handleError(result.error)
  return successResponse(result.value)
})

/** Marca ou desmarca um workspace como beta. */
export const PATCH = withAxiom(async (request: NextRequest) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const consent = await requireConsent(
    auth.value.user.id,
    'PATCH /api/admin/feature-flags/workspaces',
  )
  if (!consent.ok) return handleError(consent.error)

  const json = await readJsonBody(request, { allowEmpty: true })
  if (!json.ok) return handleError(json.error)
  const parsed = SetWorkspaceBetaSchema.safeParse(json.value)
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      parsed.error.issues,
    )
  }

  const result = await AdminFeatureFlagService.setWorkspaceBeta(
    auth.value.user.id,
    parsed.data,
  )
  if (!result.ok) return handleError(result.error)
  return successResponse(result.value)
})
