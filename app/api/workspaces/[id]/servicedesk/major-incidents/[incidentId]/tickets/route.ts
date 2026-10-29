import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { LinkSdMajorIncidentTicketsSchema } from '@/src/schemas/sd-major-incident.schema'
import { SdMajorIncidentService } from '@/src/services/sd-major-incident.service'

export const POST = sdConfigRoute({
  consent:
    'POST /api/workspaces/[id]/servicedesk/major-incidents/[incidentId]/tickets',
  body: LinkSdMajorIncidentTicketsSchema,
  handler: ({ userId, params, body }) =>
    SdMajorIncidentService.linkTickets(
      userId,
      params.id,
      params.incidentId,
      body,
    ),
})
