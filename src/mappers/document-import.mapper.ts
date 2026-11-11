import type { DocumentImport } from '@prisma/client'
import { parseProgress } from '@/src/lib/document-ai/progress'
import type { DocumentImportDTO } from '@/types/document'

export function toDocumentImportDTO(row: DocumentImport): DocumentImportDTO {
  return {
    id: row.id,
    mode: row.mode,
    status: row.status,
    kind: row.kind,
    fileName: row.fileName,
    progress: parseProgress(row.progress),
    documentId: row.documentId,
    error: row.error,
    costUsd: row.costUsd === null ? null : Number(row.costUsd),
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
  }
}
