import type { Job } from 'bullmq'
import { describe, expect, it, vi } from 'vitest'

const { expireDueMock, loggerMock } = vi.hoisted(() => ({
  expireDueMock: vi.fn(),
  loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@/src/services/document-expiry.service', () => ({
  DocumentExpiryService: { expireDue: expireDueMock },
}))
vi.mock('@/lib/axiom/logger', () => ({ logger: loggerMock }))

import { DocumentsExpiryJob } from '@/src/lib/queue/jobs'
import { processDocumentsExpiry } from '@/src/lib/queue/processors/documents-expiry'

function fakeJob(name: string, id = 'job-1'): Job {
  return { id, name, data: {} } as unknown as Job
}

describe('processDocumentsExpiry', () => {
  it('expires the overdue documents on the daily tick', async () => {
    expireDueMock.mockResolvedValue({
      ok: true,
      value: { candidates: 2, expired: 1, notified: 1 },
    })
    const result = await processDocumentsExpiry(
      fakeJob(DocumentsExpiryJob.RunTick),
    )
    expect(result).toEqual({ candidates: 2, expired: 1, notified: 1 })
    expect(loggerMock.info).toHaveBeenCalledWith(
      'queue.documents_expiry.tick_completed',
      expect.objectContaining({ expired: 1 }),
    )
  })

  it('throws so BullMQ retries when the batch read fails', async () => {
    expireDueMock.mockResolvedValue({
      ok: false,
      error: { code: 'DATABASE_ERROR', message: 'boom' },
    })
    await expect(
      processDocumentsExpiry(fakeJob(DocumentsExpiryJob.RunTick)),
    ).rejects.toThrow('DATABASE_ERROR')
  })

  it('rejects unknown job names', async () => {
    await expect(processDocumentsExpiry(fakeJob('nope'))).rejects.toThrow(
      'Unknown documents-expiry job: nope (id=job-1)',
    )
    await expect(
      processDocumentsExpiry({ name: 'nope', data: {} } as unknown as Job),
    ).rejects.toThrow('(id=unknown)')
  })
})
