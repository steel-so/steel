import { apiV1Route } from '@/src/lib/api/v1-route'
import { SendV1WhatsAppTemplateSchema } from '@/src/schemas/api-v1.schema'
import { ApiV1Service } from '@/src/services/api-v1.service'

/** `steel zap send --template`, to a conversation or to a contact. */
export const POST = apiV1Route({
  access: 'write',
  module: 'COMMUNICATION',
  consent: 'POST /api/v1/whatsapp/messages/template',
  body: SendV1WhatsAppTemplateSchema,
  status: 201,
  handler: ({ session, body }) =>
    ApiV1Service.sendWhatsAppTemplate(
      session.userId,
      session.workspaceId,
      body,
    ),
})
