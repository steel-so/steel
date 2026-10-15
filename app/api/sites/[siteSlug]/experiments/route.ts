import type { NextRequest } from 'next/server'
import { withAxiom } from '@/lib/axiom/server'
import { apiLimiter, consume } from '@/src/lib/rate-limit'
import { abCookieName } from '@/src/lib/sites/experiment-runtime'
import { clientIp } from '@/src/lib/sites/visitor'
import { RecordSiteExperimentEventsSchema } from '@/src/schemas/site-experiment.schema'
import { SiteExperimentService } from '@/src/services/site-experiment.service'
import { readJsonBody } from '@/utils/http-request'
import {
  handleError,
  standardError,
  successResponse,
} from '@/utils/http-response'

type Params = { params: Promise<{ siteSlug: string }> }

/** A/B test beacon of a published site (exposures and conversions).
 * Public (no session); the runtime sends it under the same consent rule as
 * the page views. The variant is recomputed on the server. */
export const POST = withAxiom(async (request: NextRequest, ctx: Params) => {
  const ip = clientIp(request.headers.get('x-forwarded-for'))

  const limit = await consume(apiLimiter, `ip:${ip}`)
  if (!limit.ok) return handleError(limit.error)

  const { siteSlug } = await ctx.params
  const json = await readJsonBody(request)
  if (!json.ok) return handleError(json.error)
  const parsed = RecordSiteExperimentEventsSchema.safeParse(json.value)
  if (!parsed.success) {
    return standardError(
      'VALIDATION_ERROR',
      'Dados inválidos',
      parsed.error.issues,
    )
  }

  const result = await SiteExperimentService.recordEvents(
    siteSlug,
    {
      ip,
      userAgent: request.headers.get('user-agent') ?? '',
      cookie: request.cookies.get(abCookieName(siteSlug))?.value ?? null,
    },
    parsed.data,
  )
  if (!result.ok) return handleError(result.error)

  return successResponse(result.value, 202)
})
