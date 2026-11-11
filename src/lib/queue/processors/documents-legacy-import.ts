import type { Job } from 'bullmq'
import { logger } from '@/lib/axiom/logger'
import { DocumentLegacyImportService } from '@/src/services/document-legacy-import.service'
import { DocumentsLegacyImportJob } from '../jobs'
import { getDocumentsLegacyImportQueue } from '../queues'

type RunResult = { workspaces: number }
type WorkspaceResult = { templates: number; proposals: number; failed: number }

/** One job per workspace, deduplicated while a previous one is kept. */
export function workspaceJobId(workspaceId: string): string {
  return `documents-legacy-import-ws-${workspaceId}`
}

/**
 * Legacy proposals → documents (ADR 0063). `run` lists the workspaces with
 * legacy records and enqueues one `import-workspace` each; that job
 * migrates templates, then proposals, in batches. Both are idempotent.
 */
export async function processDocumentsLegacyImport(
  job: Job,
): Promise<RunResult | WorkspaceResult> {
  switch (job.name) {
    case DocumentsLegacyImportJob.Run: {
      const workspaces = await DocumentLegacyImportService.listWorkspaces()
      if (!workspaces.ok) {
        throw new Error(
          `Failed to list legacy proposal workspaces: ${workspaces.error.code} (${workspaces.error.message})`,
        )
      }
      const queue = getDocumentsLegacyImportQueue()
      for (const workspaceId of workspaces.value) {
        await queue.add(
          DocumentsLegacyImportJob.ImportWorkspace,
          { workspaceId },
          { jobId: workspaceJobId(workspaceId) },
        )
      }
      logger.info('queue.documents_legacy_import.run_completed', {
        component: 'Worker',
        jobId: job.id,
        workspaces: workspaces.value.length,
      })
      return { workspaces: workspaces.value.length }
    }
    case DocumentsLegacyImportJob.ImportWorkspace: {
      const { workspaceId } = job.data as { workspaceId: string }
      const result =
        await DocumentLegacyImportService.importWorkspace(workspaceId)
      if (!result.ok) {
        // Reading the pending records failed: let BullMQ retry the batch.
        throw new Error(
          `Failed to migrate legacy proposals of ${workspaceId}: ${result.error.code} (${result.error.message})`,
        )
      }
      logger.info('queue.documents_legacy_import.workspace_completed', {
        component: 'Worker',
        jobId: job.id,
        workspaceId,
        ...result.value,
      })
      return result.value
    }
    default:
      throw new Error(
        `Unknown documents-legacy-import job: ${job.name} (id=${job.id ?? 'unknown'})`,
      )
  }
}
