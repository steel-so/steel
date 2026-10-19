import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { requireConsent } from '@/src/lib/consent'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { UpdateAiEvalSetSchema } from '@/src/schemas/ai-eval.schema'
import { AiEvalService } from '@/src/services/ai-eval.service'
import { readJsonBody } from '@/utils/http-request'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = { params: Promise<{ id: string; setId: string }> }

/** One eval set with its cases. */
export const GET = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const { id, setId } = await ctx.params
  const result = await AiEvalService.getSet(auth.value.user.id, id, setId)
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})

/** Renames or edits an eval set. */
export const PATCH = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const consent = await requireConsent(
    auth.value.user.id,
    'PATCH /api/workspaces/[id]/ai/evals/[setId]',
  )
  if (!consent.ok) return handleError(consent.error)

  const [{ id, setId }, json] = await Promise.all([
    ctx.params,
    readJsonBody(request),
  ])
  if (!json.ok) return handleError(json.error)
  const parsed = UpdateAiEvalSetSchema.safeParse(json.value)
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      parsed.error.issues,
    )
  }

  const result = await AiEvalService.updateSet(
    auth.value.user.id,
    id,
    setId,
    parsed.data,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})

/** Deletes an eval set with its cases and runs. */
export const DELETE = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const consent = await requireConsent(
    auth.value.user.id,
    'DELETE /api/workspaces/[id]/ai/evals/[setId]',
  )
  if (!consent.ok) return handleError(consent.error)

  const { id, setId } = await ctx.params
  const result = await AiEvalService.deleteSet(auth.value.user.id, id, setId)
  if (!result.ok) return handleError(result.error)

  return successResponse({ id: setId })
})
