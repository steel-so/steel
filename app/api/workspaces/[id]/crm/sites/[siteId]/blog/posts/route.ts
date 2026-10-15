import { validationError } from '@/src/errors'
import { err } from '@/src/lib/result'
import {
  type CreateSitePostDTO,
  CreateSitePostSchema,
  ListSitePostsQuerySchema,
} from '@/src/schemas/site-blog.schema'
import { SitePostService } from '@/src/services/site-post.service'
import { siteRoute } from '../../../_lib/handler'

type Params = { id: string; siteId: string }

/** `?status=&categoryId=&tagId=&authorId=&search=&page=&pageSize=` */
export const GET = siteRoute<Params>({}, ({ userId, params, request }) => {
  const search = new URL(request.url).searchParams
  const parsed = ListSitePostsQuerySchema.safeParse(
    Object.fromEntries(
      [...search.entries()].filter(([, value]) => value !== ''),
    ),
  )
  if (!parsed.success) {
    return Promise.resolve(
      err(validationError('Filtros inválidos', parsed.error.issues)),
    )
  }
  return SitePostService.list(userId, params.id, params.siteId, parsed.data)
})

export const POST = siteRoute<Params, CreateSitePostDTO>(
  {
    consent: '/api/workspaces/[id]/crm/sites/[siteId]/blog/posts',
    body: CreateSitePostSchema,
    status: 201,
  },
  ({ userId, params, body }) =>
    SitePostService.create(userId, params.id, params.siteId, body),
)
