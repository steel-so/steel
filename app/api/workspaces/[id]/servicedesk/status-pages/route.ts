import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { CreateSdStatusPageSchema } from '@/src/schemas/sd-status-page.schema'
import { SdStatusPageService } from '@/src/services/sd-status-page.service'

export const GET = sdConfigRoute({
  handler: ({ userId, params }) => SdStatusPageService.list(userId, params.id),
})

export const POST = sdConfigRoute({
  consent: 'POST /api/workspaces/[id]/servicedesk/status-pages',
  body: CreateSdStatusPageSchema,
  status: 201,
  handler: ({ userId, params, body }) =>
    SdStatusPageService.create(userId, params.id, body),
})
