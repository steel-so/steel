import { validationError } from '@/src/errors'
import { err } from '@/src/lib/result'
import { SiteAnalyticsQuerySchema } from '@/src/schemas/site-analytics.schema'
import { SiteAnalyticsService } from '@/src/services/site-analytics.service'
import { siteRoute } from '../../_lib/handler'

type Params = { id: string; siteId: string }

/** `?from=YYYY-MM-DD&to=YYYY-MM-DD` (days in the site's timezone; default:
 * the last 30 days). */
export const GET = siteRoute<Params>({}, ({ userId, params, request }) => {
  const search = new URL(request.url).searchParams
  const parsed = SiteAnalyticsQuerySchema.safeParse({
    from: search.get('from') || undefined,
    to: search.get('to') || undefined,
  })
  if (!parsed.success) {
    return Promise.resolve(
      err(validationError('Período inválido', parsed.error.issues)),
    )
  }
  return SiteAnalyticsService.get(userId, params.id, params.siteId, parsed.data)
})
