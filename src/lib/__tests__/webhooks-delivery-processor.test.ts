import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const run = vi.hoisted(() => vi.fn())
vi.mock('@/src/services/webhook-delivery-runner', () => ({
  runWebhookDelivery: run,
}))

import { databaseError } from '@/src/errors'
import { WebhooksDeliveryJob } from '@/src/lib/queue/jobs'
import { processWebhooksDelivery } from '@/src/lib/queue/processors/webhooks-delivery'
import { err, ok } from '@/src/lib/result'

function job(
  data: Record<string, unknown>,
  { attempts = 6, attemptsMade = 0, name = WebhooksDeliveryJob.Deliver } = {},
): Job {
  return {
    name,
    id: 'j1',
    data,
    opts: { attempts },
    attemptsMade,
  } as unknown as Job
}

describe('processWebhooksDelivery', () => {
  beforeEach(() => {
    run.mockResolvedValue(ok({ outcome: 'succeeded', delivery: null }))
  })

  it('should run one attempt and return its outcome', async () => {
    await expect(
      processWebhooksDelivery(job({ deliveryId: 'd1' })),
    ).resolves.toBe('succeeded')
    expect(run).toHaveBeenCalledWith('d1', {
      finalAttempt: false,
      manual: false,
    })
  })

  it('should flag the last attempt and manual re-deliveries', async () => {
    await processWebhooksDelivery(
      job({ deliveryId: 'd1', manual: true }, { attempts: 1 }),
    )
    expect(run).toHaveBeenCalledWith('d1', { finalAttempt: true, manual: true })
    await processWebhooksDelivery(
      job({ deliveryId: 'd1' }, { attemptsMade: 5 }),
    )
    expect(run).toHaveBeenLastCalledWith('d1', {
      finalAttempt: true,
      manual: false,
    })
  })

  it('should throw to retry a failed attempt with attempts left', async () => {
    run.mockResolvedValue(
      ok({ outcome: 'retry', delivery: { error: 'http_500' } }),
    )
    await expect(
      processWebhooksDelivery(job({ deliveryId: 'd1' }, { attemptsMade: 1 })),
    ).rejects.toThrow('webhooks-delivery attempt 2/6 failed: http_500')
    run.mockResolvedValue(ok({ outcome: 'retry', delivery: null }))
    await expect(
      processWebhooksDelivery(job({ deliveryId: 'd1' })),
    ).rejects.toThrow('failed: unknown')
  })

  it('should complete (not fail) on a final HTTP failure', async () => {
    run.mockResolvedValue(ok({ outcome: 'failed', delivery: null }))
    await expect(
      processWebhooksDelivery(job({ deliveryId: 'd1' }, { attemptsMade: 5 })),
    ).resolves.toBe('failed')
  })

  it('should throw on a database error and on an unknown job', async () => {
    run.mockResolvedValue(err(databaseError('boom')))
    await expect(
      processWebhooksDelivery(job({ deliveryId: 'd1' })),
    ).rejects.toThrow('webhooks-delivery deliver failed: DATABASE_ERROR')
    await expect(
      processWebhooksDelivery(job({}, { name: 'nope' as never })),
    ).rejects.toThrow('Unknown webhooks-delivery job: nope (id=j1)')
    await expect(
      processWebhooksDelivery({
        name: 'nope',
        data: {},
        opts: {},
      } as unknown as Job),
    ).rejects.toThrow('(id=unknown)')
  })

  it('should default to a single attempt when the job has no attempts option', async () => {
    const bare = {
      name: WebhooksDeliveryJob.Deliver,
      id: 'j2',
      data: { deliveryId: 'd2' },
      opts: {},
      attemptsMade: 0,
    } as unknown as Job
    await processWebhooksDelivery(bare)
    expect(run).toHaveBeenCalledWith('d2', {
      finalAttempt: true,
      manual: false,
    })
  })
})
