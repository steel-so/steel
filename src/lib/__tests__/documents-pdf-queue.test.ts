import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  upsertJobScheduler: vi.fn(),
  logger: { info: vi.fn() },
}))

vi.mock('@/src/lib/queue/queues', () => ({
  getDocumentsPdfQueue: () => ({
    add: mocks.add,
    upsertJobScheduler: mocks.upsertJobScheduler,
  }),
}))
vi.mock('@/lib/axiom/logger', () => ({ logger: mocks.logger }))

import {
  enqueueDocumentPdfRender,
  scheduleDocumentsPdfJobs,
} from '@/src/lib/queue/documents-pdf'
import {
  DocumentExportRetentionMs,
  DocumentsPdfPruneCron,
} from '@/src/lib/queue/retention'

describe('documents-pdf queue', () => {
  it('should queue one render per export (job id = export id)', async () => {
    await enqueueDocumentPdfRender('exp-1')
    expect(mocks.add).toHaveBeenCalledWith(
      'render',
      { exportId: 'exp-1' },
      { jobId: 'documents-pdf-exp-1' },
    )
  })

  it('should schedule the daily prune in São Paulo time', async () => {
    await scheduleDocumentsPdfJobs()
    expect(mocks.upsertJobScheduler).toHaveBeenCalledWith(
      'prune-expired',
      { pattern: '45 3 * * *', tz: 'America/Sao_Paulo' },
      { name: 'prune-expired', data: {} },
    )
    expect(DocumentsPdfPruneCron).toBe('45 3 * * *')
    expect(DocumentExportRetentionMs).toBe(7 * 24 * 60 * 60 * 1000)
    expect(mocks.logger.info).toHaveBeenCalledWith(
      'queue.scheduler.documents_pdf_registered',
      expect.objectContaining({ pattern: '45 3 * * *' }),
    )
  })
})
