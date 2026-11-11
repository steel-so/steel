import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { DocumentAnalyticsQuerySchema } from '@/src/schemas/document-analytics.schema'
import { DocumentAnalyticsService } from '@/src/services/document-analytics.service'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = { params: Promise<{ id: string; documentId: string }> }

export const GET = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const { id, documentId } = await ctx.params
  const { searchParams } = new URL(request.url)
  const parsed = DocumentAnalyticsQuerySchema.safeParse({
    days: searchParams.get('days') ?? undefined,
  })

  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Parâmetros inválidos',
      parsed.error.issues,
    )
  }

  const result = await DocumentAnalyticsService.get(
    auth.value.user.id,
    id,
    documentId,
    parsed.data,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
