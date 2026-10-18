import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { requireConsent } from '@/src/lib/consent'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { UpdateAiEvalCaseSchema } from '@/src/schemas/ai-eval.schema'
import { AiEvalService } from '@/src/services/ai-eval.service'
import { readJsonBody } from '@/utils/http-request'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = { params: Promise<{ id: string; setId: string; caseId: string }> }

/** Edits a test case. */
export const PATCH = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const consent = await requireConsent(
    auth.value.user.id,
    'PATCH /api/workspaces/[id]/ai/evals/[setId]/cases/[caseId]',
  )
  if (!consent.ok) return handleError(consent.error)

  const [{ id, setId, caseId }, json] = await Promise.all([
    ctx.params,
    readJsonBody(request),
  ])
  if (!json.ok) return handleError(json.error)
  const parsed = UpdateAiEvalCaseSchema.safeParse(json.value)
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      parsed.error.issues,
    )
  }

  const result = await AiEvalService.updateCase(
    auth.value.user.id,
    id,
    setId,
    caseId,
    parsed.data,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})

/** Deletes a test case (past runs keep their snapshot). */
export const DELETE = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const consent = await requireConsent(
    auth.value.user.id,
    'DELETE /api/workspaces/[id]/ai/evals/[setId]/cases/[caseId]',
  )
  if (!consent.ok) return handleError(consent.error)

  const { id, setId, caseId } = await ctx.params
  const result = await AiEvalService.deleteCase(
    auth.value.user.id,
    id,
    setId,
    caseId,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
