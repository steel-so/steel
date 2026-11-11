import type { DocumentExportRow } from '@/src/repositories/document-export.repository'
import type { DocumentExportDTO } from '@/types/document'

/**
 * `downloadUrl` comes from the service: only a READY export inside its
 * retention window has one.
 */
export function toDocumentExportDTO(
  row: DocumentExportRow,
  downloadUrl: string | null,
): DocumentExportDTO {
  return {
    id: row.id,
    status: row.status,
    versionNumber: row.version?.number ?? null,
    sizeBytes: row.sizeBytes,
    pageCount: row.pageCount,
    error: row.error,
    downloadUrl,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
  }
}
