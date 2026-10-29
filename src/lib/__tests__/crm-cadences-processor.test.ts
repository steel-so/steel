import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  tick: vi.fn(),
}))

vi.mock('@/lib/axiom/logger', () => ({ logger: mocks.loggerMock }))
vi.mock('@/src/services/crm-cadence-run.service', () => ({
  CrmCadenceRunService: { tick: mocks.tick },
}))

import { CrmCadencesJob, QueueName } from '@/src/lib/queue/jobs'
import { processCrmCadences } from '@/src/lib/queue/processors/crm-cadences'
import { CrmCadencesCron } from '@/src/lib/queue/retention'

function job(name: string, id: string | null = 'job-1'): Job {
  return { id: id ?? undefined, name, data: {} } as unknown as Job
}

const tally = (claimed: number) => ({
  claimed,
  sent: claimed,
  skipped: 0,
  failed: 0,
  completed: 0,
  rescheduled: 0,
  stopped: 0,
  errors: 0,
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('processCrmCadences', () => {
  it('should register its own queue and run every minute', () => {
    expect(QueueName.CrmCadences).toBe('crm-cadences')
    expect(CrmCadencesCron).toBe('* * * * *')
  })

  it('should run the tick and log when something was claimed', async () => {
    mocks.tick.mockResolvedValue({ ok: true, value: tally(3) })

    expect(await processCrmCadences(job(CrmCadencesJob.RunTick))).toEqual(
      tally(3),
    )
    expect(mocks.loggerMock.info).toHaveBeenCalledWith(
      'queue.crm_cadences.tick_completed',
      expect.objectContaining({ jobId: 'job-1', claimed: 3 }),
    )
  })

  it('should stay quiet on an idle tick', async () => {
    mocks.tick.mockResolvedValue({ ok: true, value: tally(0) })
    await processCrmCadences(job(CrmCadencesJob.RunTick))
    expect(mocks.loggerMock.info).not.toHaveBeenCalled()
  })

  it('should throw so BullMQ retries when the claim fails', async () => {
    mocks.tick.mockResolvedValue({
      ok: false,
      error: { code: 'DATABASE_ERROR', message: 'down' },
    })
    await expect(
      processCrmCadences(job(CrmCadencesJob.RunTick)),
    ).rejects.toThrow('Failed to run CRM cadences: DATABASE_ERROR (down)')
  })

  it('should reject an unknown job name', async () => {
    await expect(processCrmCadences(job('nope', null))).rejects.toThrow(
      'Unknown crm-cadences job: nope (id=unknown)',
    )
  })
})
