import { logger } from '@/lib/axiom/logger'
import { DocumentsPdfJob } from './jobs'
import { getDocumentsPdfQueue } from './queues'
import { DocumentsPdfPruneCron, RetentionTimezone } from './retention'

/**
 * documents-pdf (ADR 0063): queues the render of one PDF export. The job id
 * is the export id, so a double click never prints the same export twice.
 */
export async function enqueueDocumentPdfRender(
  exportId: string,
): Promise<void> {
  await getDocumentsPdfQueue().add(
    DocumentsPdfJob.Render,
    { exportId },
    { jobId: `documents-pdf-${exportId}` },
  )
}

/** Daily delete of the exports past retention (file in MinIO + row). */
export async function scheduleDocumentsPdfJobs(): Promise<void> {
  const queue = getDocumentsPdfQueue()
  await queue.upsertJobScheduler(
    DocumentsPdfJob.PruneExpired,
    { pattern: DocumentsPdfPruneCron, tz: RetentionTimezone },
    { name: DocumentsPdfJob.PruneExpired, data: {} },
  )

  logger.info('queue.scheduler.documents_pdf_registered', {
    component: 'Worker',
    pattern: DocumentsPdfPruneCron,
    timezone: RetentionTimezone,
  })
}
