import { paginateArray } from '@/src/lib/api/v1-pagination'
import { apiV1Route } from '@/src/lib/api/v1-route'
import { ListV1WhatsAppTemplatesSchema } from '@/src/schemas/api-v1.schema'
import { WhatsAppTemplateService } from '@/src/services/whatsapp-template.service'

/** Templates for `steel zap send --template` (approved ones by default). */
export const GET = apiV1Route({
  access: 'read',
  module: 'COMMUNICATION',
  query: ListV1WhatsAppTemplatesSchema,
  handler: async ({ session, query }) => {
    const result = await WhatsAppTemplateService.list(
      session.userId,
      session.workspaceId,
    )
    if (!result.ok) return result
    const templates = result.value.filter(
      (template) =>
        (query.status === 'ALL' || template.status === query.status) &&
        (!query.connectionId || template.connectionId === query.connectionId),
    )
    return paginateArray(templates, query)
  },
})
