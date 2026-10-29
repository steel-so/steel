import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { SdMajorIncidentService } from '@/src/services/sd-major-incident.service'

export const DELETE = sdConfigRoute({
  consent:
    'DELETE /api/workspaces/[id]/servicedesk/major-incidents/[incidentId]/tickets/[ticketId]',
  handler: ({ userId, params }) =>
    SdMajorIncidentService.unlinkTicket(
      userId,
      params.id,
      params.incidentId,
      params.ticketId,
    ),
})
