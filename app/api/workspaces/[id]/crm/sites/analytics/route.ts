import { validationError } from '@/src/errors'
import { err } from '@/src/lib/result'
import { SiteAnalyticsSummaryQuerySchema } from '@/src/schemas/site-analytics.schema'
import { SiteAnalyticsService } from '@/src/services/site-analytics.service'
import { siteRoute } from '../_lib/handler'

type Params = { id: string }

/** `?days=14` → daily views of every site (the list's sparklines). */
export const GET = siteRoute<Params>({}, ({ userId, params, request }) => {
  const search = new URL(request.url).searchParams
  const parsed = SiteAnalyticsSummaryQuerySchema.safeParse({
    days: search.get('days') ?? undefined,
  })
  if (!parsed.success) {
    return Promise.resolve(
      err(validationError('Período inválido', parsed.error.issues)),
    )
  }
  return SiteAnalyticsService.summary(userId, params.id, parsed.data)
})
