import { sdConfigRoute } from '@/src/lib/servicedesk/config-route'
import {
  DeclareSdMajorIncidentSchema,
  ListSdMajorIncidentsQuerySchema,
} from '@/src/schemas/sd-major-incident.schema'
import { SdMajorIncidentService } from '@/src/services/sd-major-incident.service'

export const GET = sdConfigRoute({
  query: ListSdMajorIncidentsQuerySchema,
  handler: ({ userId, params, query }) =>
    SdMajorIncidentService.list(userId, params.id, query),
})

export const POST = sdConfigRoute({
  consent: 'POST /api/workspaces/[id]/servicedesk/major-incidents',
  body: DeclareSdMajorIncidentSchema,
  status: 201,
  handler: ({ userId, params, body }) =>
    SdMajorIncidentService.declare(userId, params.id, body),
})
