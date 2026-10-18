import type { Job } from 'bullmq'
import {
  runWebhookDelivery,
  type WebhookAttemptOutcome,
} from '@/src/services/webhook-delivery-runner'
import { WebhooksDeliveryJob, type WebhooksDeliveryJobPayload } from '../jobs'

/**
 * Queue `webhooks-delivery` (ADR 0036). `deliver` makes one attempt of a
 * `WebhookDelivery`; a failed attempt with attempts left throws so BullMQ
 * retries with backoff (6 attempts). The last attempt never throws on an
 * HTTP failure — it is the customer's endpoint, not a Steel incident, so it
 * must not reach the failed set (and the queue failure alarm). Database
 * errors do throw.
 */
export async function processWebhooksDelivery(
  job: Job,
): Promise<WebhookAttemptOutcome> {
  switch (job.name) {
    case WebhooksDeliveryJob.Deliver: {
      const data =
        job.data as WebhooksDeliveryJobPayload[typeof WebhooksDeliveryJob.Deliver]
      const maxAttempts = job.opts.attempts ?? 1
      const result = await runWebhookDelivery(data.deliveryId, {
        finalAttempt: job.attemptsMade + 1 >= maxAttempts,
        manual: data.manual === true,
      })
      if (!result.ok) {
        throw new Error(
          `webhooks-delivery deliver failed: ${result.error.code}`,
        )
      }
      if (result.value.outcome === 'retry') {
        throw new Error(
          `webhooks-delivery attempt ${job.attemptsMade + 1}/${maxAttempts} failed: ${result.value.delivery?.error ?? 'unknown'}`,
        )
      }
      return result.value.outcome
    }
    default:
      throw new Error(
        `Unknown webhooks-delivery job: ${job.name} (id=${job.id ?? 'unknown'})`,
      )
  }
}
