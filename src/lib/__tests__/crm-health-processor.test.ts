import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  recomputeTick: vi.fn(),
}))

vi.mock('@/lib/axiom/logger', () => ({ logger: mocks.loggerMock }))
vi.mock('@/src/services/crm-health.service', () => ({
  CrmHealthService: { recomputeTick: mocks.recomputeTick },
}))

import { CrmHealthJob, QueueName } from '@/src/lib/queue/jobs'
import { processCrmHealth } from '@/src/lib/queue/processors/crm-health'
import { CrmHealthCron } from '@/src/lib/queue/retention'

function job(name: string, data: unknown = {}, id: string | null = 'job-1') {
  return { id: id ?? undefined, name, data } as unknown as Job
}

const tally = {
  workspaces: 1,
  opportunities: 4,
  companies: 2,
  notified: 1,
  removed: 0,
  errors: 0,
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('processCrmHealth', () => {
  it('registers its own queue and runs hourly', () => {
    expect(QueueName.CrmHealth).toBe('crm-health')
    expect(CrmHealthCron).toBe('20 * * * *')
  })

  it('runs the recompute and logs the tally', async () => {
    mocks.recomputeTick.mockResolvedValue({ ok: true, value: tally })

    expect(await processCrmHealth(job(CrmHealthJob.Recompute))).toEqual(tally)
    expect(mocks.recomputeTick).toHaveBeenCalledWith({ workspaceId: undefined })
    expect(mocks.loggerMock.info).toHaveBeenCalledWith(
      'queue.crm_health.recompute_completed',
      expect.objectContaining({ component: 'Worker', notified: 1 }),
    )
  })

  it('scopes to one workspace when the payload asks', async () => {
    mocks.recomputeTick.mockResolvedValue({ ok: true, value: tally })
    await processCrmHealth(job(CrmHealthJob.Recompute, { workspaceId: 'ws1' }))
    expect(mocks.recomputeTick).toHaveBeenCalledWith({ workspaceId: 'ws1' })
  })

  it('tolerates a job without data', async () => {
    mocks.recomputeTick.mockResolvedValue({ ok: true, value: tally })
    await processCrmHealth(job(CrmHealthJob.Recompute, undefined))
    expect(mocks.recomputeTick).toHaveBeenCalledWith({ workspaceId: undefined })
  })

  it('throws so BullMQ retries when the run fails', async () => {
    mocks.recomputeTick.mockResolvedValue({
      ok: false,
      error: { code: 'DATABASE_ERROR', message: 'boom' },
    })
    await expect(processCrmHealth(job(CrmHealthJob.Recompute))).rejects.toThrow(
      'crm-health recompute failed: DATABASE_ERROR boom',
    )
  })

  it('rejects unknown jobs, with or without an id', async () => {
    await expect(processCrmHealth(job('nope'))).rejects.toThrow(
      'Unknown crm-health job: nope (id=job-1)',
    )
    await expect(processCrmHealth(job('nope', {}, null))).rejects.toThrow(
      'id=unknown',
    )
  })
})
