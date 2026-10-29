import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { AddSdStatusSubscriberSchema } from '@/src/schemas/sd-status-page.schema'
import { SdStatusPageService } from '@/src/services/sd-status-page.service'

export const GET = sdConfigRoute({
  handler: ({ userId, params }) =>
    SdStatusPageService.listSubscribers(userId, params.id, params.pageId),
})

export const POST = sdConfigRoute({
  consent:
    'POST /api/workspaces/[id]/servicedesk/status-pages/[pageId]/subscribers',
  body: AddSdStatusSubscriberSchema,
  status: 201,
  handler: ({ userId, params, body }) =>
    SdStatusPageService.addSubscriber(userId, params.id, params.pageId, body),
})
