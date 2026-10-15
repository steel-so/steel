import {
  type CreateSiteFromTemplateDTO,
  CreateSiteFromTemplateSchema,
} from '@/src/schemas/site-studio.schema'
import { SiteStudioService } from '@/src/services/site-studio.service'
import { siteRoute } from '../_lib/handler'

type Params = { id: string }

/** New site from a full-page template (home page, header and footer). */
export const POST = siteRoute<Params, CreateSiteFromTemplateDTO>(
  {
    consent: '/api/workspaces/[id]/crm/sites/from-template',
    body: CreateSiteFromTemplateSchema,
    status: 201,
  },
  ({ userId, params, body }) =>
    SiteStudioService.createFromTemplate(userId, params.id, body),
)
