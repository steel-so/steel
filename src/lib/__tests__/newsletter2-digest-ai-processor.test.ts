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
vi.mock('@/src/services/crm-newsletter-digest.service', () => ({
  CrmNewsletterDigestService: { tick: vi.fn() },
}))
vi.mock('@/src/services/crm-newsletter-ab.service', () => ({
  CrmNewsletterAbService: { decideDue: vi.fn() },
}))

import { CrmNewsletterJob } from '@/src/lib/queue/jobs'
import { runCrmNewsletterJob } from '@/src/lib/queue/processors/crm-newsletter'
import { CrmNewsletterAbService } from '@/src/services/crm-newsletter-ab.service'
import { CrmNewsletterDigestService } from '@/src/services/crm-newsletter-digest.service'

const digest = vi.mocked(CrmNewsletterDigestService)
const ab = vi.mocked(CrmNewsletterAbService)
const NOW = new Date('2026-10-28T13:00:00.000Z')
const job = (name: string): Job => ({ id: 'j1', name, data: {} }) as Job

describe('crm-newsletter processor: digest and A/B ticks', () => {
  beforeEach(() => vi.clearAllMocks())

  it('runs the digest tick', async () => {
    digest.tick.mockResolvedValue(ok({ due: 2, ran: 2, failed: 0 }))
    expect(
      await runCrmNewsletterJob(job(CrmNewsletterJob.DigestTick), NOW),
    ).toEqual({ due: 2, ran: 2, failed: 0 })
    expect(digest.tick).toHaveBeenCalledWith(NOW)
    digest.tick.mockResolvedValue(err(databaseError()))
    await expect(
      runCrmNewsletterJob(job(CrmNewsletterJob.DigestTick), NOW),
    ).rejects.toThrow('CRM newsletter digest tick failed: DATABASE_ERROR')
  })

  it('runs the A/B tick', async () => {
    ab.decideDue.mockResolvedValue(ok({ decided: 1, released: 80 }))
    expect(
      await runCrmNewsletterJob(job(CrmNewsletterJob.AbTick), NOW),
    ).toEqual({ decided: 1, released: 80 })
    ab.decideDue.mockResolvedValue(err(databaseError()))
    await expect(
      runCrmNewsletterJob(job(CrmNewsletterJob.AbTick), NOW),
    ).rejects.toThrow('CRM newsletter A/B tick failed: DATABASE_ERROR')
  })
})
