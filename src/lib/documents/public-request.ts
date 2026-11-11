import { clientIpFrom } from '@/src/lib/analytics/geoip'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { ok, type Result } from '@/src/lib/result'
import { hashDocumentIp } from './hash'

/** IP and user agent of a public `/api/documents/[token]` request. */
export interface DocumentPublicRequest {
  ip: string
  userAgent: string | null
}

/**
 * Gate of the public document routes (no session): rate limit by hashed IP
 * (the raw IP never becomes a Redis key), then the evidence for the answer.
 */
export async function guardDocumentPublicRequest(
  request: Request,
): Promise<Result<DocumentPublicRequest>> {
  const ip = clientIpFrom(request.headers) ?? 'unknown'
  const limit = await consume(apiLimiter, `document-ip:${hashDocumentIp(ip)}`)
  if (!limit.ok) return limit
  return ok({ ip, userAgent: request.headers.get('user-agent') })
}
