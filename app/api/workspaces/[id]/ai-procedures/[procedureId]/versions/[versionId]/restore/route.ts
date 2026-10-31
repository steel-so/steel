import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { requireConsent } from '@/src/lib/consent'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { RestoreAiProcedureVersionSchema } from '@/src/schemas/ai-procedure.schema'
import { AiProcedureService } from '@/src/services/ai-procedure.service'
import { readJsonBody } from '@/utils/http-request'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = { params: Promise<{ id: string; procedureId: string; versionId: string }> }

export const POST = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const consent = await requireConsent(
    auth.value.user.id,
    'POST /api/workspaces/[id]/ai-procedures/[procedureId]/versions/[versionId]/restore',
  )
  if (!consent.ok) return handleError(consent.error)

  const [{ id, procedureId, versionId }, json] = await Promise.all([
    ctx.params,
    readJsonBody(request),
  ])
  if (!json.ok) return handleError(json.error)
  const parsed = RestoreAiProcedureVersionSchema.safeParse(json.value)
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      parsed.error.issues,
    )
  }

  const result = await AiProcedureService.restoreVersion(
    auth.value.user.id,
    id,
    procedureId,
    versionId,
    parsed.data.changeNote,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value)
})
