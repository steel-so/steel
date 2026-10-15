import { SiteAiService } from '@/src/services/site-ai.service'
import { siteRoute } from '../_lib/handler'

type Params = { id: string }

/** Prefill of "Gerar com IA" (brand, products, forms), quota and cost
 * estimate of each AI action. */
export const GET = siteRoute<Params>({}, ({ userId, params }) =>
  SiteAiService.context(userId, params.id),
)
