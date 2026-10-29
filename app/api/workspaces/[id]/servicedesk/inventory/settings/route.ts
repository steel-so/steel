import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { UpdateSdInventorySettingsSchema } from '@/src/schemas/sd-inventory.schema'
import { SdInventorySettingsService } from '@/src/services/sd-inventory-settings.service'

export const GET = sdConfigRoute({
  handler: ({ userId, params }) =>
    SdInventorySettingsService.get(userId, params.id),
})

export const PATCH = sdConfigRoute({
  consent: 'PATCH /api/workspaces/[id]/servicedesk/inventory/settings',
  body: UpdateSdInventorySettingsSchema,
  handler: ({ userId, params, body }) =>
    SdInventorySettingsService.update(userId, params.id, body),
})
