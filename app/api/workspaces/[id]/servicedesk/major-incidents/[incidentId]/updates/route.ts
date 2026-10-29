import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { AddSdMajorIncidentUpdateSchema } from '@/src/schemas/sd-major-incident.schema'
import { SdMajorIncidentService } from '@/src/services/sd-major-incident.service'

export const POST = sdConfigRoute({
  consent:
    'POST /api/workspaces/[id]/servicedesk/major-incidents/[incidentId]/updates',
  body: AddSdMajorIncidentUpdateSchema,
  status: 201,
  handler: ({ userId, params, body }) =>
    SdMajorIncidentService.addUpdate(
      userId,
      params.id,
      params.incidentId,
      body,
    ),
})
