import { siteRoute } from '@/app/api/workspaces/[id]/crm/sites/_lib/handler'
import { validationError } from '@/src/errors'
import { err } from '@/src/lib/result'
import { BioSlugAvailabilityQuerySchema } from '@/src/schemas/bio-link.schema'
import { BioLinkService } from '@/src/services/bio-link.service'

type Params = { id: string }

/** `?slug=minha-loja[&bioLinkId=…]` → `{ slug, available }`; an invalid slug
 * answers 422 with the rule it breaks. */
export const GET = siteRoute<Params>(
  {},
  async ({ userId, params, request }) => {
    const search = request.nextUrl.searchParams
    const parsed = BioSlugAvailabilityQuerySchema.safeParse({
      slug: search.get('slug') ?? '',
      bioLinkId: search.get('bioLinkId') ?? undefined,
    })
    if (!parsed.success) {
      return err(validationError('Endereço inválido', parsed.error.issues))
    }
    return BioLinkService.slugAvailability(
      userId,
      params.id,
      parsed.data.slug,
      parsed.data.bioLinkId,
    )
  },
)
