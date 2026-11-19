import {
  type CreateSeoKeywordDTO,
  CreateSeoKeywordSchema,
} from '@/src/schemas/site-seo.schema'
import { SiteSeoService } from '@/src/services/site-seo.service'
import { siteRoute } from '../../../_lib/handler'

type Params = { id: string; siteId: string }

/** Starts tracking a keyword on the site. */
export const POST = siteRoute<Params, CreateSeoKeywordDTO>(
  {
    consent: '/api/workspaces/[id]/crm/sites/[siteId]/search/keywords',
    body: CreateSeoKeywordSchema,
    status: 201,
  },
  ({ userId, params, body }) =>
    SiteSeoService.addKeyword(userId, params.id, params.siteId, body),
)
