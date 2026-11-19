import { siteRoute } from '@/app/api/workspaces/[id]/crm/sites/_lib/handler'
import { validationError } from '@/src/errors'
import { err } from '@/src/lib/result'
import { BioAnalyticsQuerySchema } from '@/src/schemas/bio-link.schema'
import { BioLinkService } from '@/src/services/bio-link.service'

type Params = { id: string; bioLinkId: string }

/** `?days=7|30|90` (default 30): views, clicks per day and per link, referrers,
 * UTM sources, countries and devices. */
export const GET = siteRoute<Params>(
  {},
  async ({ userId, params, request }) => {
    const parsed = BioAnalyticsQuerySchema.safeParse({
      days: request.nextUrl.searchParams.get('days') ?? undefined,
    })
    if (!parsed.success) {
      return err(validationError('Período inválido', parsed.error.issues))
    }
    return BioLinkService.analytics(
      userId,
      params.id,
      params.bioLinkId,
      parsed.data,
    )
  },
)
