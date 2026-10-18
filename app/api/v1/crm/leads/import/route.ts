import { apiV1Route } from '@/src/lib/api/v1-route'
import {
  ImportV1CrmLeadsQuerySchema,
  V1_LEAD_IMPORT_MAX_BYTES,
} from '@/src/schemas/api-v1.schema'
import { ApiV1Service } from '@/src/services/api-v1.service'

/** `steel crm lead import <csv>`: the CSV itself is the body (`text/csv`). */
export const POST = apiV1Route({
  access: 'write',
  module: 'CRM',
  consent: 'POST /api/v1/crm/leads/import',
  query: ImportV1CrmLeadsQuerySchema,
  text: { maxBytes: V1_LEAD_IMPORT_MAX_BYTES },
  handler: ({ session, query, body }) =>
    ApiV1Service.importLeads(
      session.userId,
      session.workspaceId,
      body as string,
      query.source,
    ),
})
