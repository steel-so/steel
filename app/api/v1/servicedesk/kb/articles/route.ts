import { paginateArray } from '@/src/lib/api/v1-pagination'
import { apiV1Route } from '@/src/lib/api/v1-route'
import { ListV1SdKbArticlesSchema } from '@/src/schemas/api-v1.schema'
import { CreateSdKbArticleSchema } from '@/src/schemas/sd-kb-article.schema'
import { SdKbArticleService } from '@/src/services/sd-kb-article.service'

/**
 * Knowledge base articles (summaries, no content). With `q` it is the
 * relevance search; without it, the whole tree. Requesters only see what is
 * published in the portal.
 */
export const GET = apiV1Route({
  access: 'read',
  module: 'SERVICE_DESK',
  query: ListV1SdKbArticlesSchema,
  handler: async ({ session, query }) => {
    const result = query.q
      ? await SdKbArticleService.search(session.userId, session.workspaceId, {
          q: query.q,
          status: query.status,
          visibility: query.visibility,
          categoryId: query.categoryId,
          tag: query.tag?.toLowerCase(),
          limit: 50,
        })
      : await SdKbArticleService.list(session.userId, session.workspaceId, {
          archived: false,
        })
    if (!result.ok) return result
    return paginateArray(result.value, query)
  },
})

/** Creates a draft; emits `servicedesk.kb_article.created`. */
export const POST = apiV1Route({
  access: 'write',
  module: 'SERVICE_DESK',
  consent: 'POST /api/v1/servicedesk/kb/articles',
  body: CreateSdKbArticleSchema,
  status: 201,
  handler: ({ session, body }) =>
    SdKbArticleService.create(session.userId, session.workspaceId, body),
})
