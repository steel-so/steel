import type { Job } from 'bullmq'
import { logger } from '@/lib/axiom/logger'
import { DocumentImportService } from '@/src/services/document-import.service'
import { DocumentsAiJob, type DocumentsAiJobPayload } from '../jobs'

type ImportJob = Job<DocumentsAiJobPayload['import']>

async function processImport(job: ImportJob): Promise<void> {
  const { importId, title } = job.data
  const result = await DocumentImportService.run(importId, { title })
  // Database failure: let BullMQ retry. Provider, quota and file problems
  // end the import as FAILED with a pt-BR reason and do not retry.
  if (!result.ok) {
    throw new Error(`Failed to run document import: ${result.error.code}`)
  }
  const level = result.value.status === 'failed' ? 'warn' : 'info'
  logger[level]('queue.documents_ai.processed', {
    component: 'DocumentsAi',
    jobId: job.id,
    importId,
    ...result.value,
  })
}

export async function processDocumentsAi(job: Job): Promise<void> {
  switch (job.name) {
    case DocumentsAiJob.Import:
      return processImport(job as ImportJob)
    default:
      throw new Error(
        `Unknown documents-ai job: ${job.name} (id=${job.id ?? 'unknown'})`,
      )
  }
}
