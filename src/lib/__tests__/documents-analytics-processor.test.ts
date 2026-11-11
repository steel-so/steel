import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

const { flushMock, loggerMock } = vi.hoisted(() => ({
  flushMock: vi.fn(),
  loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@/src/services/document-tracking.service', () => ({
  DocumentTrackingService: { flush: flushMock },
}))
vi.mock('@/lib/axiom/logger', () => ({ logger: loggerMock }))

import { processDocumentsAnalytics } from '@/src/lib/queue/processors/documents-analytics'

function fakeJob(name: string, id: string | null = 'job-1'): Job {
  return { id, name, data: {} } as unknown as Job
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('processDocumentsAnalytics', () => {
  it('flushes the reading buffer and logs what moved', async () => {
    flushMock.mockResolvedValue(
      ok({ sessions: 3, sections: 7, skipped: false }),
    )

    const result = await processDocumentsAnalytics(fakeJob('flush'))

    expect(result).toEqual({ sessions: 3, sections: 7, skipped: false })
    expect(loggerMock.info).toHaveBeenCalledWith(
      'queue.documents_analytics.flushed',
      expect.objectContaining({ jobId: 'job-1', sessions: 3, sections: 7 }),
    )
  })

  it('stays quiet when nothing moved', async () => {
    flushMock.mockResolvedValue(ok({ sessions: 0, sections: 0, skipped: true }))

    const result = await processDocumentsAnalytics(fakeJob('flush'))

    expect(result.skipped).toBe(true)
    expect(loggerMock.info).not.toHaveBeenCalled()
  })

  it('throws when the flush fails, keeping the batch for the next run', async () => {
    flushMock.mockResolvedValue(err(databaseError('boom')))

    await expect(processDocumentsAnalytics(fakeJob('flush'))).rejects.toThrow(
      'Failed to flush document analytics: DATABASE_ERROR (boom)',
    )
  })

  it('rejects unknown job names', async () => {
    await expect(
      processDocumentsAnalytics(fakeJob('other', null)),
    ).rejects.toThrow('Unknown documents-analytics job: other (id=unknown)')
    await expect(processDocumentsAnalytics(fakeJob('other'))).rejects.toThrow(
      '(id=job-1)',
    )
  })
})
