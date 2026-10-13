import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { consume, whatsappWebhookLimiter } from '@/src/lib/rate-limit'
import { getClientIp } from '@/src/lib/rate-limit-helpers'
import { PabxCallWebhookSchema } from '@/src/schemas/whatsapp-phone-call.schema'
import { WhatsAppPhoneCallService } from '@/src/services/whatsapp-phone-call.service'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

/**
 * Call status reported by the PABX dialplan (Asterisk `CURL()`), as a form
 * body. Public: the per-call `token` authenticates the report.
 */
export const POST = withAxiom(async (request: NextRequest) => {
  const limit = await consume(
    whatsappWebhookLimiter,
    `pabx:${getClientIp(request)}`,
  )
  if (!limit.ok) return handleError(limit.error)

  const form = await request.formData().catch(() => null)
  const parsed = PabxCallWebhookSchema.safeParse(
    form ? Object.fromEntries(form) : {},
  )
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      parsed.error.issues,
    )
  }

  const result = await WhatsAppPhoneCallService.handleWebhook(parsed.data)
  if (!result.ok) return handleError(result.error)

  return successResponse({ status: result.value.status })
})
