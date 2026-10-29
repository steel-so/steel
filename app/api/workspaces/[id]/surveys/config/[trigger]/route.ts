import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { getAuthSession } from '@/src/lib/auth-session'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import {
  SurveyConfigTriggerSchema,
  UpdateSurveyConfigSchema,
} from '@/src/schemas/satisfaction-survey.schema'
import { SatisfactionSurveyService } from '@/src/services/satisfaction-survey.service'
import { readJsonBody } from '@/utils/http-request'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = { params: Promise<{ id: string; trigger: string }> }

/** Saves the rule of one trigger (`CONVERSATION_CLOSED` | `TICKET_RESOLVED`). */
export const PUT = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const [{ id, trigger }, json] = await Promise.all([
    ctx.params,
    readJsonBody(request),
  ])
  const parsedTrigger = SurveyConfigTriggerSchema.safeParse(trigger)
  if (!parsedTrigger.success) {
    return standardError('VALIDATION_ERROR', 'Gatilho inválido')
  }
  if (!json.ok) return handleError(json.error)
  const parsed = UpdateSurveyConfigSchema.safeParse(json.value)
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      parsed.error.issues,
    )
  }

  const result = await SatisfactionSurveyService.updateConfig(
    auth.value.user.id,
    id,
    parsedTrigger.data,
    parsed.data,
  )
  if (!result.ok) return handleError(result.error)
  return successResponse(result.value)
})
