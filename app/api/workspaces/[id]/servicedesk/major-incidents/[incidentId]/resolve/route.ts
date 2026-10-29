import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { ResolveSdMajorIncidentSchema } from '@/src/schemas/sd-major-incident.schema'
import { SdMajorIncidentService } from '@/src/services/sd-major-incident.service'

export const POST = sdConfigRoute({
  consent:
    'POST /api/workspaces/[id]/servicedesk/major-incidents/[incidentId]/resolve',
  body: ResolveSdMajorIncidentSchema,
  handler: ({ userId, params, body }) =>
    SdMajorIncidentService.resolve(userId, params.id, params.incidentId, body),
})
