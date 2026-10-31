import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { CreateSdMaintenanceSchema } from '@/src/schemas/sd-status-maintenance.schema'
import { SdStatusMaintenanceService } from '@/src/services/sd-status-maintenance.service'

export const GET = sdConfigRoute({
  handler: ({ userId, params }) =>
    SdStatusMaintenanceService.listMaintenances(userId, params.id),
})

export const POST = sdConfigRoute({
  consent: 'POST /api/workspaces/[id]/servicedesk/status-maintenances',
  body: CreateSdMaintenanceSchema,
  status: 201,
  handler: ({ userId, params, body }) =>
    SdStatusMaintenanceService.createMaintenance(userId, params.id, body),
})
