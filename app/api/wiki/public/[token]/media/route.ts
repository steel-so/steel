import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { getClientIp } from '@/src/lib/rate-limit-helpers'
import { WikiPublicService } from '@/src/services/wiki-public.service'
import { handleError, standardError } from '@/utils/http-response'

type Params = { params: Promise<{ token: string }> }

const INLINE_TYPES = /^(image|video|audio)\//

/**
 * Media of a published wiki page, for anonymous visitors of `/w/<token>`.
 * No session: the token is the credential, and only keys the published page
 * references are served (see `WikiPublicService.getMedia`).
 */
export const GET = withAxiom(async (request: NextRequest, ctx: Params) => {
  const limit = await consume(apiLimiter, `ip:${getClientIp(request)}`)
  if (!limit.ok) return handleError(limit.error)

  const { token } = await ctx.params
  const key = request.nextUrl.searchParams.get('key')
  if (!key) {
    return standardError('VALIDATION_ERROR', 'Parâmetro key é obrigatório')
  }

  const media = await WikiPublicService.getMedia(token, key)
  if (!media.ok) return handleError(media.error)

  const inline = INLINE_TYPES.test(media.value.contentType)
  return new Response(media.value.body, {
    headers: {
      'Content-Type': media.value.contentType,
      // Revoking the link must stop the media too: short, private cache.
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      // An SVG opened directly must not run scripts on our origin.
      'Content-Security-Policy':
        "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      ...(!inline && { 'Content-Disposition': 'attachment' }),
      ...(media.value.contentLength !== undefined && {
        'Content-Length': String(media.value.contentLength),
      }),
    },
  })
})
