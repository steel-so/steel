import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { UpdateSdStatusPageSchema } from '@/src/schemas/sd-status-page.schema'
import { SdStatusPageService } from '@/src/services/sd-status-page.service'

export const GET = sdConfigRoute({
  handler: ({ userId, params }) =>
    SdStatusPageService.get(userId, params.id, params.pageId),
})

export const PATCH = sdConfigRoute({
  consent: 'PATCH /api/workspaces/[id]/servicedesk/status-pages/[pageId]',
  body: UpdateSdStatusPageSchema,
  handler: ({ userId, params, body }) =>
    SdStatusPageService.update(userId, params.id, params.pageId, body),
})

export const DELETE = sdConfigRoute({
  consent: 'DELETE /api/workspaces/[id]/servicedesk/status-pages/[pageId]',
  handler: ({ userId, params }) =>
    SdStatusPageService.remove(userId, params.id, params.pageId),
})
