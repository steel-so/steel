import { webhookApiContext, webhookV1Route } from '@/src/lib/webhooks/v1-route'
import { TriggerWebhookEventSchema } from '@/src/schemas/webhook.schema'
import { WebhookService } from '@/src/services/webhook.service'

/** `steel trigger <type>`: a test event with the catalog's sample data. */
export const POST = webhookV1Route({
  write: true,
  body: TriggerWebhookEventSchema,
  status: 202,
  handler: ({ session, body }) =>
    WebhookService.trigger(
      session.userId,
      session.workspaceId,
      body,
      webhookApiContext(session),
    ),
})
