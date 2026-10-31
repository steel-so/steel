import type { Job } from 'bullmq'
import { describe, expect, it, vi } from 'vitest'

const { runScheduled, loggerMock } = vi.hoisted(() => ({
  runScheduled: vi.fn(),
  loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@/src/services/crm-duplicate.service', () => ({
  CrmDuplicateService: { runScheduled },
}))
vi.mock('@/lib/axiom/logger', () => ({ logger: loggerMock }))

import { CrmDuplicatesJob } from '@/src/lib/queue/jobs'
import { processCrmDuplicates } from '@/src/lib/queue/processors/crm-duplicates'

const job = (name: string, id: string | null = 'job-1') =>
  ({ id, name, data: {} }) as unknown as Job

describe('processCrmDuplicates', () => {
  it('runs the daily scan and logs the totals', async () => {
    const value = { workspaces: 3, created: 5, failed: 0 }
    runScheduled.mockResolvedValue({ ok: true, value })

    const result = await processCrmDuplicates(job(CrmDuplicatesJob.RunScan))

    expect(result).toEqual(value)
    expect(loggerMock.info).toHaveBeenCalledWith(
      'queue.crm_duplicates.scan_completed',
      expect.objectContaining({ jobId: 'job-1', workspaces: 3, created: 5 }),
    )
  })

  it('throws so BullMQ retries when the scan fails', async () => {
    runScheduled.mockResolvedValue({
      ok: false,
      error: { code: 'DATABASE_ERROR', message: 'down' },
    })

    await expect(
      processCrmDuplicates(job(CrmDuplicatesJob.RunScan)),
    ).rejects.toThrow('DATABASE_ERROR')
  })

  it('rejects unknown job names', async () => {
    await expect(processCrmDuplicates(job('nope'))).rejects.toThrow(
      'Unknown crm-duplicates job: nope (id=job-1)',
    )
    await expect(processCrmDuplicates(job('nope', null))).rejects.toThrow(
      'id=unknown',
    )
  })
})
