import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/services/crm-newsletter-welcome-send.service', () => ({
  CrmNewsletterWelcomeSendService: { tick: vi.fn() },
}))
vi.mock('@/src/services/crm-newsletter-reengagement.service', () => ({
  CrmNewsletterReengagementService: {
    runMonthly: vi.fn(),
    resolveDue: vi.fn(),
  },
}))

import { CrmNewsletterAutomationJob } from '@/src/lib/queue/jobs'
import {
  processCrmNewsletterAutomation,
  runCrmNewsletterAutomationJob,
} from '@/src/lib/queue/processors/crm-newsletter-automation'
import { CrmNewsletterReengagementService } from '@/src/services/crm-newsletter-reengagement.service'
import { CrmNewsletterWelcomeSendService } from '@/src/services/crm-newsletter-welcome-send.service'

const welcome = vi.mocked(CrmNewsletterWelcomeSendService)
const reengagement = vi.mocked(CrmNewsletterReengagementService)
const NOW = new Date('2026-10-28T13:00:00.000Z')

function job(name: string): Job {
  return { id: 'j1', name, data: {} } as Job
}

describe('crm-newsletter-automation processor', () => {
  beforeEach(() => vi.clearAllMocks())

  it('runs the welcome tick', async () => {
    const value = {
      newsletters: 1,
      errors: 0,
      sent: 2,
      skipped: 0,
      failed: 0,
      deferred: 0,
    }
    welcome.tick.mockResolvedValue(ok(value))
    expect(
      await runCrmNewsletterAutomationJob(
        job(CrmNewsletterAutomationJob.WelcomeTick),
        NOW,
      ),
    ).toEqual(value)
    expect(welcome.tick).toHaveBeenCalledWith(NOW)
  })

  it('runs the monthly re-engagement and the daily resolve', async () => {
    reengagement.runMonthly.mockResolvedValue(
      ok({ newsletters: 1, sent: 3, errors: 0 }),
    )
    reengagement.resolveDue.mockResolvedValue(
      ok({ reengaged: 1, unsubscribed: 1, flagged: 0, skipped: 0 }),
    )
    expect(
      await runCrmNewsletterAutomationJob(
        job(CrmNewsletterAutomationJob.ReengagementMonthly),
        NOW,
      ),
    ).toEqual({ newsletters: 1, sent: 3, errors: 0 })
    expect(
      await runCrmNewsletterAutomationJob(
        job(CrmNewsletterAutomationJob.ReengagementResolve),
        NOW,
      ),
    ).toMatchObject({ reengaged: 1, unsubscribed: 1 })
  })

  it('throws when a run fails, and on unknown jobs', async () => {
    welcome.tick.mockResolvedValue(err(databaseError()))
    reengagement.runMonthly.mockResolvedValue(err(databaseError()))
    reengagement.resolveDue.mockResolvedValue(err(databaseError()))
    for (const name of Object.values(CrmNewsletterAutomationJob)) {
      await expect(
        runCrmNewsletterAutomationJob(job(name), NOW),
      ).rejects.toThrow('DATABASE_ERROR')
    }
    await expect(
      runCrmNewsletterAutomationJob(job('nope'), NOW),
    ).rejects.toThrow('Unknown crm-newsletter-automation job: nope')
    await expect(
      runCrmNewsletterAutomationJob({ name: 'nope', data: {} } as Job, NOW),
    ).rejects.toThrow('id=unknown')
  })

  it('processes with the current time', async () => {
    welcome.tick.mockResolvedValue(
      ok({
        newsletters: 0,
        errors: 0,
        sent: 0,
        skipped: 0,
        failed: 0,
        deferred: 0,
      }),
    )
    await processCrmNewsletterAutomation(
      job(CrmNewsletterAutomationJob.WelcomeTick),
    )
    expect(welcome.tick).toHaveBeenCalledWith(expect.any(Date))
  })
})
