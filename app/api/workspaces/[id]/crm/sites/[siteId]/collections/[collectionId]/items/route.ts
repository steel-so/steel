import { validationError } from '@/src/errors'
import { err } from '@/src/lib/result'
import {
  COLLECTION_ITEM_STATUSES,
  type CreateSiteCollectionItemDTO,
  CreateSiteCollectionItemSchema,
} from '@/src/schemas/site-collection.schema'
import { SiteCollectionService } from '@/src/services/site-collection.service'
import { siteRoute } from '../../../../_lib/handler'

type Params = { id: string; siteId: string; collectionId: string }

/** `?status=DRAFT|PUBLISHED&search=` */
export const GET = siteRoute<Params>({}, ({ userId, params, request }) => {
  const query = new URL(request.url).searchParams
  const status = query.get('status') || undefined
  if (
    status &&
    !(COLLECTION_ITEM_STATUSES as readonly string[]).includes(status)
  ) {
    return Promise.resolve(err(validationError('Status inválido')))
  }
  return SiteCollectionService.listItems(
    userId,
    params.id,
    params.siteId,
    params.collectionId,
    {
      status: status as 'DRAFT' | 'PUBLISHED' | undefined,
      search: query.get('search')?.trim().slice(0, 100) || undefined,
    },
  )
})

export const POST = siteRoute<Params, CreateSiteCollectionItemDTO>(
  {
    consent:
      '/api/workspaces/[id]/crm/sites/[siteId]/collections/[collectionId]/items',
    body: CreateSiteCollectionItemSchema,
    status: 201,
  },
  ({ userId, params, body }) =>
    SiteCollectionService.createItem(
      userId,
      params.id,
      params.siteId,
      params.collectionId,
      body,
    ),
)
