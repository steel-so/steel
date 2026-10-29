import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { surveyNotFound } from '@/src/errors'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { AnswerSurveySchema } from '@/src/schemas/satisfaction-survey.schema'
import { SatisfactionSurveyService } from '@/src/services/satisfaction-survey.service'
import { readJsonBody } from '@/utils/http-request'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = { params: Promise<{ token: string }> }

function clientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  )
}

const TOKEN = /^[A-Za-z0-9_-]{16,64}$/

/** What the e-mail link page shows (no session — the token is the access). */
export const GET = withAxiom(async (request: NextRequest, ctx: Params) => {
  const limit = await consume(apiLimiter, `ip:${clientIp(request)}`)
  if (!limit.ok) return handleError(limit.error)

  const { token } = await ctx.params
  if (!TOKEN.test(token)) return handleError(surveyNotFound())

  const result = await SatisfactionSurveyService.getPublic(token)
  if (!result.ok) return handleError(result.error)
  return successResponse(result.value)
})

/** Answers from the e-mail link page (`{ score, comment? }`). */
export const POST = withAxiom(async (request: NextRequest, ctx: Params) => {
  const limit = await consume(apiLimiter, `ip:${clientIp(request)}`)
  if (!limit.ok) return handleError(limit.error)

  const [{ token }, json] = await Promise.all([
    ctx.params,
    readJsonBody(request),
  ])
  if (!TOKEN.test(token)) return handleError(surveyNotFound())
  if (!json.ok) return handleError(json.error)
  const parsed = AnswerSurveySchema.safeParse(json.value)
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      parsed.error.issues,
    )
  }

  const result = await SatisfactionSurveyService.answerPublic(
    token,
    parsed.data,
  )
  if (!result.ok) return handleError(result.error)
  return successResponse(result.value)
})
