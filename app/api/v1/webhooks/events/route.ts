import { ok } from '@/src/lib/result'
import { webhookApiContext, webhookV1Route } from '@/src/lib/webhooks/v1-route'
import { WebhookService } from '@/src/services/webhook.service'

/** Event catalog, filtered by the token's modules (ADR 0036). */
export const GET = webhookV1Route({
  handler: async ({ session }) =>
    ok(WebhookService.listEvents(webhookApiContext(session))),
})
