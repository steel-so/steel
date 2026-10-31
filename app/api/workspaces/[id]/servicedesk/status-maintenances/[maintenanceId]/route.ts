import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { UpdateSdMaintenanceSchema } from '@/src/schemas/sd-status-maintenance.schema'
import { SdStatusMaintenanceService } from '@/src/services/sd-status-maintenance.service'

export const PATCH = sdConfigRoute({
  consent:
    'PATCH /api/workspaces/[id]/servicedesk/status-maintenances/[maintenanceId]',
  body: UpdateSdMaintenanceSchema,
  handler: ({ userId, params, body }) =>
    SdStatusMaintenanceService.updateMaintenance(
      userId,
      params.id,
      params.maintenanceId,
      body,
    ),
})

/** Cancels the window (it stays in the list as "Cancelada"). */
export const DELETE = sdConfigRoute({
  consent:
    'DELETE /api/workspaces/[id]/servicedesk/status-maintenances/[maintenanceId]',
  handler: ({ userId, params }) =>
    SdStatusMaintenanceService.cancelMaintenance(
      userId,
      params.id,
      params.maintenanceId,
    ),
})
