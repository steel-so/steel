import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import { SdMajorIncidentService } from '@/src/services/sd-major-incident.service'

export const GET = sdConfigRoute({
  handler: ({ userId, params }) =>
    SdMajorIncidentService.suggestions(userId, params.id, params.incidentId),
})
