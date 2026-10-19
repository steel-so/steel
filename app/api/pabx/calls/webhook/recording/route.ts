import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { consume, whatsappWebhookLimiter } from '@/src/lib/rate-limit'
import { getClientIp } from '@/src/lib/rate-limit-helpers'
import { PabxRecordingUploadSchema } from '@/src/schemas/whatsapp-phone-call.schema'
import { PhoneCallRecordingService } from '@/src/services/phone-call-recording.service'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

/**
 * Call recording uploaded by the PABX at hangup (ADR 0043), as multipart
 * `token` + `file`. Public (under the webhook prefix): the per-call
 * callback token authenticates the upload.
 */
export const POST = withAxiom(async (request: NextRequest) => {
  const limit = await consume(
    whatsappWebhookLimiter,
    `pabx:${getClientIp(request)}`,
  )
  if (!limit.ok) return handleError(limit.error)

  const form = await request.formData().catch(() => null)
  const parsed = PabxRecordingUploadSchema.safeParse({
    token: form?.get('token') ?? undefined,
  })
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      parsed.error.issues,
    )
  }
  const file = form?.get('file')
  if (!(file instanceof File)) {
    return standardError('VALIDATION_ERROR', 'Envie a gravação no campo file')
  }

  const result = await PhoneCallRecordingService.intake(parsed.data.token, file)
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value, 201)
})
