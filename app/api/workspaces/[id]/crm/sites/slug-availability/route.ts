import { validationError } from '@/src/errors'
import { err } from '@/src/lib/result'
import { SiteSlugSchema } from '@/src/schemas/site.schema'
import { SiteService } from '@/src/services/site.service'
import { siteRoute } from '../_lib/handler'

type Params = { id: string }

/** `?slug=clinica[&siteId=…]` → `{ slug, available }`; an invalid slug
 * answers 400 with the rule it breaks. */
export const GET = siteRoute<Params>(
  {},
  async ({ userId, params, request }) => {
    const url = new URL(request.url)
    const parsed = SiteSlugSchema.safeParse(url.searchParams.get('slug') ?? '')
    if (!parsed.success) {
      return err(validationError('Endereço inválido', parsed.error.issues))
    }
    return SiteService.checkSlug(
      userId,
      params.id,
      parsed.data,
      url.searchParams.get('siteId') ?? undefined,
    )
  },
)
