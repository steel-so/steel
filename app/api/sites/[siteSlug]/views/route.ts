import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { clientIp } from '@/src/lib/sites/visitor'
import { RecordSiteViewSchema } from '@/src/schemas/site-view.schema'
import { SitePublicService } from '@/src/services/site-public.service'
import { readJsonBody } from '@/utils/http-request'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = { params: Promise<{ siteSlug: string }> }

/** Page-view beacon of a published site. Public (no session); the runtime
 * sends it only when the visitor's consent allows (see SitePublicService). */
export const POST = withAxiom(async (request: NextRequest, ctx: Params) => {
  const ip = clientIp(request.headers.get('x-forwarded-for'))

  const limit = await consume(apiLimiter, `ip:${ip}`)
  if (!limit.ok) return handleError(limit.error)

  const { siteSlug } = await ctx.params
  const json = await readJsonBody(request, { allowEmpty: true })
  if (!json.ok) return handleError(json.error)
  const parsed = RecordSiteViewSchema.safeParse(json.value)
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      parsed.error.issues,
    )
  }

  const result = await SitePublicService.recordView(
    siteSlug,
    {
      ip,
      userAgent: request.headers.get('user-agent') ?? '',
      host: request.headers.get('host'),
    },
    parsed.data,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(null, 202)
})
