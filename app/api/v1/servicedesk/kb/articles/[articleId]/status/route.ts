import { apiV1Route } from '@/src/lib/api/v1-route'
import { SetSdKbArticleStatusSchema } from '@/src/schemas/sd-kb-article.schema'
import { SdKbArticleService } from '@/src/services/sd-kb-article.service'

/** Publishes (`PUBLISHED`) or sends back to draft (`DRAFT`). */
export const POST = apiV1Route({
  access: 'write',
  module: 'SERVICE_DESK',
  consent: 'POST /api/v1/servicedesk/kb/articles/[articleId]/status',
  body: SetSdKbArticleStatusSchema,
  handler: ({ session, params, body }) =>
    SdKbArticleService.setStatus(
      session.userId,
      session.workspaceId,
      params.articleId,
      body,
    ),
})
