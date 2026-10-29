import type { NextRequest } from 'next/server'
import { sdStatusPageNotFound, sdStatusSubscriberNotFound } from '@/src/errors'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { err, ok, type Result } from '@/src/lib/result'
import {
  SdStatusSlugParamSchema,
  SdStatusTokenSchema,
} from '@/src/schemas/sd-status-page.schema'

function clientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  )
}

/**
 * Common gate of the public status-page routes (no session): per-IP rate
 * limit and the shape of the slug (and token) in the path.
 */
export async function guardPublicStatusRoute(
  request: NextRequest,
  params: { slug: string; token?: string },
): Promise<Result<{ slug: string; token: string | null }>> {
  const limit = await consume(apiLimiter, `ip:${clientIp(request)}`)
  if (!limit.ok) return limit
  const slug = SdStatusSlugParamSchema.safeParse(params.slug)
  if (!slug.success) return err(sdStatusPageNotFound())
  if (params.token === undefined) return ok({ slug: slug.data, token: null })
  const token = SdStatusTokenSchema.safeParse(params.token)
  if (!token.success) return err(sdStatusSubscriberNotFound())
  return ok({ slug: slug.data, token: token.data })
}
