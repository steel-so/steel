import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { requireConsent } from '@/src/lib/consent'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { UpdateAiProcedureSchema } from '@/src/schemas/ai-procedure.schema'
import { AiProcedureService } from '@/src/services/ai-procedure.service'
import { readJsonBody } from '@/utils/http-request'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = { params: Promise<{ id: string; procedureId: string }> }

export const GET = withAxiom(async (_request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const { id, procedureId } = await ctx.params
  const result = await AiProcedureService.get(
    auth.value.user.id,
    id,
    procedureId,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})

export const PATCH = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const consent = await requireConsent(
    auth.value.user.id,
    'PATCH /api/workspaces/[id]/ai-procedures/[procedureId]',
  )
  if (!consent.ok) return handleError(consent.error)

  const [{ id, procedureId }, json] = await Promise.all([
    ctx.params,
    readJsonBody(request),
  ])
  if (!json.ok) return handleError(json.error)
  const parsed = UpdateAiProcedureSchema.safeParse(json.value)
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      parsed.error.issues,
    )
  }

  const result = await AiProcedureService.update(
    auth.value.user.id,
    id,
    procedureId,
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
    'DELETE /api/workspaces/[id]/ai-procedures/[procedureId]',
  )
  if (!consent.ok) return handleError(consent.error)

  const { id, procedureId } = await ctx.params
  const result = await AiProcedureService.remove(
    auth.value.user.id,
    id,
    procedureId,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
