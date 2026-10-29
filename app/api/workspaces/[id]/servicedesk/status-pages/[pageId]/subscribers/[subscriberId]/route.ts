import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { SdStatusPageService } from '@/src/services/sd-status-page.service'

export const DELETE = sdConfigRoute({
  consent:
    'DELETE /api/workspaces/[id]/servicedesk/status-pages/[pageId]/subscribers/[subscriberId]',
  handler: ({ userId, params }) =>
    SdStatusPageService.removeSubscriber(
      userId,
      params.id,
      params.pageId,
      params.subscriberId,
    ),
})
