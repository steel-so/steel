import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { MarkTourSeenSchema } from '@/src/schemas/tour-progress.schema'
import { TourProgressService } from '@/src/services/tour-progress.service'
import { readJsonBody } from '@/utils/http-request'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

export const GET = withAxiom(async () => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const result = await TourProgressService.list(auth.value.user.id)
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})

export const PUT = withAxiom(async (request: NextRequest) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limited = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limited.ok) return handleError(limited.error)

  const json = await readJsonBody(request)
  if (!json.ok) return handleError(json.error)
  const parsed = MarkTourSeenSchema.safeParse(json.value)
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      parsed.error.issues,
    )
  }

  const result = await TourProgressService.markSeen(
    auth.value.user.id,
    parsed.data,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
