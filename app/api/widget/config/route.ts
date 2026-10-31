import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { consume, widgetReadLimiter } from '@/src/lib/rate-limit'
import { getClientIp } from '@/src/lib/rate-limit-helpers'
import { WidgetKeyQuerySchema } from '@/src/schemas/whatsapp-widget.schema'
import { WhatsAppWidgetPublicService } from '@/src/services/whatsapp-widget-public.service'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'
import {
  authorizeWidgetRequest,
  widgetPreflight,
  withWidgetCors,
} from '@/utils/widget-http'

export const OPTIONS = (request: NextRequest) => widgetPreflight(request)

/** Look and behaviour of the site chat; public, key + allowed origin. */
export const GET = withAxiom(async (request: NextRequest) => {
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

  const config = await WhatsAppWidgetPublicService.getConfig(ctx)
  if (!config.ok) return withWidgetCors(handleError(config.error), origin)
  return withWidgetCors(successResponse(config.value), origin)
})
