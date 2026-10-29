import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/services/crm-newsletter-send.service', () => ({
  CrmNewsletterSendService: { tick: vi.fn(), dispatch: vi.fn() },
}))
vi.mock('@/src/services/crm-newsletter-whatsapp.service', () => ({
  CrmNewsletterWhatsAppService: { dispatch: vi.fn() },
}))

import { CrmNewsletterJob } from '@/src/lib/queue/jobs'
import {
  processCrmNewsletter,
  runCrmNewsletterJob,
} from '@/src/lib/queue/processors/crm-newsletter'
import { CrmNewsletterSendService } from '@/src/services/crm-newsletter-send.service'
import { CrmNewsletterWhatsAppService } from '@/src/services/crm-newsletter-whatsapp.service'

const send = vi.mocked(CrmNewsletterSendService)
const NOW = new Date('2026-10-28T13:00:00.000Z')

function job(name: string, data: unknown = {}): Job {
  return { id: 'j1', name, data } as Job
}

describe('crm-newsletter processor', () => {
  beforeEach(() => vi.clearAllMocks())

  it('runs the tick', async () => {
    const value = { released: 0, started: 1, failed: 0, dispatched: 2 }
    send.tick.mockResolvedValue(ok(value))
    expect(await runCrmNewsletterJob(job(CrmNewsletterJob.Tick), NOW)).toEqual(
      value,
    )
    expect(send.tick).toHaveBeenCalledWith(NOW)
  })

  it('throws when the tick fails', async () => {
    send.tick.mockResolvedValue(err(databaseError()))
    await expect(
      runCrmNewsletterJob(job(CrmNewsletterJob.Tick), NOW),
    ).rejects.toThrow('DATABASE_ERROR')
  })

  it('dispatches an issue and surfaces failures and retries', async () => {
    const data = { issueId: 'is1' }
    send.dispatch.mockResolvedValueOnce(ok({ status: 'drained' }))
    expect(
      await runCrmNewsletterJob(job(CrmNewsletterJob.Dispatch, data), NOW),
    ).toEqual({ status: 'drained' })
    expect(send.dispatch).toHaveBeenCalledWith('is1', NOW)

    send.dispatch.mockResolvedValueOnce(
      ok({ status: 'retry', reason: 'rate limited' }),
    )
    await expect(
      runCrmNewsletterJob(job(CrmNewsletterJob.Dispatch, data), NOW),
    ).rejects.toThrow('deferred: rate limited')

    send.dispatch.mockResolvedValueOnce(err(databaseError()))
    await expect(
      runCrmNewsletterJob(job(CrmNewsletterJob.Dispatch, data), NOW),
    ).rejects.toThrow('DATABASE_ERROR')
  })

  it('dispatches the WhatsApp version (nl2-engage)', async () => {
    const dispatch = vi.mocked(CrmNewsletterWhatsAppService.dispatch)
    const data = { issueId: 'is1' }
    dispatch.mockResolvedValueOnce(ok({ status: 'drained' }))
    expect(
      await runCrmNewsletterJob(
        job(CrmNewsletterJob.WhatsAppDispatch, data),
        NOW,
      ),
    ).toEqual({ status: 'drained' })
    expect(dispatch).toHaveBeenCalledWith('is1', NOW)
    dispatch.mockResolvedValueOnce(err(databaseError()))
    await expect(
      runCrmNewsletterJob(job(CrmNewsletterJob.WhatsAppDispatch, data), NOW),
    ).rejects.toThrow('DATABASE_ERROR')
  })

  it('rejects unknown jobs', async () => {
    await expect(runCrmNewsletterJob(job('nope'), NOW)).rejects.toThrow(
      'Unknown crm-newsletter job: nope',
    )
    await expect(
      runCrmNewsletterJob({ name: 'nope', data: {} } as Job, NOW),
    ).rejects.toThrow('id=unknown')
  })

  it('uses the current clock', async () => {
    send.tick.mockResolvedValue(
      ok({ released: 0, started: 0, failed: 0, dispatched: 0 }),
    )
    await processCrmNewsletter(job(CrmNewsletterJob.Tick))
    expect(send.tick.mock.calls[0][0]).toBeInstanceOf(Date)
  })
})
