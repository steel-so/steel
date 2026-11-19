import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { badRequest } from '@/src/errors'
import { getAuthSession } from '@/src/lib/auth-session'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { CrmBannerService } from '@/src/services/crm-banner.service'
import { handleError } from '@/utils/http-response'

type Params = { params: Promise<{ id: string }> }

/**
 * Same-origin copy of a media-library image (`?url=`), so the export canvas
 * is not tainted when the storage host sends no CORS headers.
 */
export const GET = withAxiom(async (request: NextRequest, ctx: Params) => {
  const auth = await getAuthSession()
  if (!auth.ok) return handleError(auth.error)

  const limit = await consume(apiLimiter, `user:${auth.value.user.id}`)
  if (!limit.ok) return handleError(limit.error)

  const { id } = await ctx.params
  const url = request.nextUrl.searchParams.get('url')
  if (!url) return handleError(badRequest('Informe a URL da imagem'))

  const result = await CrmBannerService.fetchImage(auth.value.user.id, id, url)
  if (!result.ok) return handleError(result.error)

  return new Response(new Uint8Array(result.value.body), {
    headers: {
      'Content-Type': result.value.contentType,
      'Cache-Control': 'private, max-age=3600',
    },
  })
})
