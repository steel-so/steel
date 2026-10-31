import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { consume, widgetReadLimiter } from '@/src/lib/rate-limit'
import { getClientIp } from '@/src/lib/rate-limit-helpers'
import {
  WidgetKeyQuerySchema,
  WidgetSurveyAnswerSchema,
} from '@/src/schemas/whatsapp-widget.schema'
import { WhatsAppWidgetPublicService } from '@/src/services/whatsapp-widget-public.service'
import { readJsonBody } from '@/utils/http-request'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'
import {
  authorizeWidgetRequest,
  widgetPreflight,
  widgetTokenFrom,
  withWidgetCors,
} from '@/utils/widget-http'

export const OPTIONS = (request: NextRequest) => widgetPreflight(request)

/** The visitor answers the open NPS/CSAT/CES survey after the chat is closed. */
export const POST = withAxiom(async (request: NextRequest) => {
  const limit = await consume(widgetReadLimiter, `ip:${getClientIp(request)}`)
  if (!limit.ok) return handleError(limit.error)

  const query = WidgetKeyQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  )
  if (!query.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      query.error.issues,
    )
  }

  const auth = await authorizeWidgetRequest(request, query.data.key)
  if (!auth.ok) return handleError(auth.error)
  const { ctx, origin } = auth.value
  const respond = (response: Response) => withWidgetCors(response, origin)

  const json = await readJsonBody(request)
  if (!json.ok) return respond(handleError(json.error))
  const parsed = WidgetSurveyAnswerSchema.safeParse(json.value)
  if (!parsed.success) {
    return respond(
      standardError('VALIDATION_ERROR', 'Dados inválidos', parsed.error.issues),
    )
  }

  const result = await WhatsAppWidgetPublicService.answerSurvey(
    ctx,
    widgetTokenFrom(request),
    parsed.data,
  )
  if (!result.ok) return respond(handleError(result.error))
  return respond(successResponse(result.value))
})
