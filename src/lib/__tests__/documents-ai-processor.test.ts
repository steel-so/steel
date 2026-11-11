import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/services/document-import.service', () => ({
  DocumentImportService: { run: vi.fn() },
}))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { logger } from '@/lib/axiom/logger'
import { DocumentImportService } from '@/src/services/document-import.service'
import { processDocumentsAi } from '../queue/processors/documents-ai'

const run = vi.mocked(DocumentImportService.run)
const log = vi.mocked(logger)

function job(name: string, data: Record<string, unknown> = {}) {
  return { id: 'job1', name, data } as unknown as Job
}

beforeEach(() => {
  run.mockResolvedValue(ok({ status: 'ready', documentId: 'doc1' }))
})

describe('processDocumentsAi()', () => {
  it('should run the import with the typed title', async () => {
    await processDocumentsAi(
      job('import', { importId: 'imp1', title: 'Proposta ACME' }),
    )

    expect(run).toHaveBeenCalledWith('imp1', { title: 'Proposta ACME' })
    expect(log.info).toHaveBeenCalledWith(
      'queue.documents_ai.processed',
      expect.objectContaining({
        importId: 'imp1',
        status: 'ready',
        documentId: 'doc1',
      }),
    )
  })

  it('should log a failed import as a warning without retrying', async () => {
    run.mockResolvedValue(ok({ status: 'failed' }))

    await expect(
      processDocumentsAi(job('import', { importId: 'imp1' })),
    ).resolves.toBeUndefined()
    expect(run).toHaveBeenCalledWith('imp1', { title: undefined })
    expect(log.warn).toHaveBeenCalledWith(
      'queue.documents_ai.processed',
      expect.objectContaining({ status: 'failed' }),
    )
  })

  it('should throw on a database failure so BullMQ retries', async () => {
    run.mockResolvedValue(err(databaseError('x')))

    await expect(
      processDocumentsAi(job('import', { importId: 'imp1' })),
    ).rejects.toThrow('DATABASE_ERROR')
  })

  it('should reject an unknown job', async () => {
    await expect(processDocumentsAi(job('other'))).rejects.toThrow(
      'Unknown documents-ai job: other (id=job1)',
    )
    await expect(
      processDocumentsAi({ name: 'other', data: {} } as unknown as Job),
    ).rejects.toThrow('(id=unknown)')
  })
})
