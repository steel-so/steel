import { apiV1Route } from '@/src/lib/api/v1-route'
import { ok } from '@/src/lib/result'
import { UpdateSdKbArticleSchema } from '@/src/schemas/sd-kb-article.schema'
import { SdKbArticleService } from '@/src/services/sd-kb-article.service'

/** With the content (Plate blocks). */
export const GET = apiV1Route({
  access: 'read',
  module: 'SERVICE_DESK',
  handler: ({ session, params }) =>
    SdKbArticleService.getById(
      session.userId,
      session.workspaceId,
      params.articleId,
    ),
})

export const PATCH = apiV1Route({
  access: 'write',
  module: 'SERVICE_DESK',
  consent: 'PATCH /api/v1/servicedesk/kb/articles/[articleId]',
  body: UpdateSdKbArticleSchema,
  handler: ({ session, params, body }) =>
    SdKbArticleService.update(
      session.userId,
      session.workspaceId,
      params.articleId,
      body,
    ),
})

/** Permanent: the article, its sub-articles, comments and media. */
export const DELETE = apiV1Route({
  access: 'write',
  module: 'SERVICE_DESK',
  consent: 'DELETE /api/v1/servicedesk/kb/articles/[articleId]',
  handler: async ({ session, params }) => {
    const result = await SdKbArticleService.remove(
      session.userId,
      session.workspaceId,
      params.articleId,
    )
    if (!result.ok) return result
    return ok({ id: params.articleId })
  },
})
