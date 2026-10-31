import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { CreateSdStatusComponentSchema } from '@/src/schemas/sd-status-maintenance.schema'
import { SdStatusMaintenanceService } from '@/src/services/sd-status-maintenance.service'

export const GET = sdConfigRoute({
  handler: ({ userId, params }) =>
    SdStatusMaintenanceService.listComponents(userId, params.id, params.pageId),
})

export const POST = sdConfigRoute({
  consent:
    'POST /api/workspaces/[id]/servicedesk/status-pages/[pageId]/components',
  body: CreateSdStatusComponentSchema,
  status: 201,
  handler: ({ userId, params, body }) =>
    SdStatusMaintenanceService.createComponent(
      userId,
      params.id,
      params.pageId,
      body,
    ),
})
