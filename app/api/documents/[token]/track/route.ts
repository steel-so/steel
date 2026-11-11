import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { consume, documentTrackLimiter } from '@/src/lib/rate-limit'
import { getClientIp } from '@/src/lib/rate-limit-helpers'
import { DocumentTrackSchema } from '@/src/schemas/document.schema'
import {
  DocumentTrackingService,
  hashDocumentIp,
} from '@/src/services/document-tracking.service'
import { readJsonBody } from '@/utils/http-request'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = { params: Promise<{ token: string }> }

/** Beacons are a few hundred bytes; anything this big is not ours. */
const MAX_BODY_BYTES = 64 * 1024

/**
 * Reading beacon of the public link (no session). `navigator.sendBeacon`
 * posts it as `text/plain`, so the body is parsed as JSON whatever the
 * content type says. Rate limited by the hashed IP.
 */
export const POST = withAxiom(async (request: NextRequest, ctx: Params) => {
  const ip = getClientIp(request)
  const limit = await consume(documentTrackLimiter, `ip:${hashDocumentIp(ip)}`)
  if (!limit.ok) return handleError(limit.error)

  const length = Number(request.headers.get('content-length') ?? 0)
  if (length > MAX_BODY_BYTES) {
    return standardError('BAD_REQUEST', 'Sinal de leitura grande demais')
  }

  const [{ token }, json] = await Promise.all([
    ctx.params,
    readJsonBody(request),
  ])
  if (!json.ok) return handleError(json.error)
  const parsed = DocumentTrackSchema.safeParse(json.value)

  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      parsed.error.issues,
    )
  }

  const result = await DocumentTrackingService.track(token, parsed.data, {
    ip,
    userAgent: request.headers.get('user-agent'),
  })
  if (!result.ok) return handleError(result.error)

  return successResponse(null, 200)
})
