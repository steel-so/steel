import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { UpdateSdStatusComponentSchema } from '@/src/schemas/sd-status-maintenance.schema'
import { SdStatusMaintenanceService } from '@/src/services/sd-status-maintenance.service'

export const PATCH = sdConfigRoute({
  consent:
    'PATCH /api/workspaces/[id]/servicedesk/status-pages/[pageId]/components/[componentId]',
  body: UpdateSdStatusComponentSchema,
  handler: ({ userId, params, body }) =>
    SdStatusMaintenanceService.updateComponent(
      userId,
      params.id,
      params.pageId,
      params.componentId,
      body,
    ),
})

export const DELETE = sdConfigRoute({
  consent:
    'DELETE /api/workspaces/[id]/servicedesk/status-pages/[pageId]/components/[componentId]',
  handler: ({ userId, params }) =>
    SdStatusMaintenanceService.removeComponent(
      userId,
      params.id,
      params.pageId,
      params.componentId,
    ),
})
