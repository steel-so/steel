import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { UpdateSdMajorIncidentSchema } from '@/src/schemas/sd-major-incident.schema'
import { SdMajorIncidentService } from '@/src/services/sd-major-incident.service'

export const GET = sdConfigRoute({
  handler: ({ userId, params }) =>
    SdMajorIncidentService.get(userId, params.id, params.incidentId),
})

export const PATCH = sdConfigRoute({
  consent:
    'PATCH /api/workspaces/[id]/servicedesk/major-incidents/[incidentId]',
  body: UpdateSdMajorIncidentSchema,
  handler: ({ userId, params, body }) =>
    SdMajorIncidentService.update(userId, params.id, params.incidentId, body),
})
