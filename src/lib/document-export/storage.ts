import { slugify } from '@/src/lib/sites/slug'

/**
 * Where the PDF exports of CRM > Documentos live (ADR 0063). Private bucket:
 * downloads go through the app (the MinIO API is never public).
 */
export const DOCUMENTS_BUCKET = 'documents'

export const PDF_CONTENT_TYPE = 'application/pdf'

/** A PDF ready to stream from MinIO. */
export interface DocumentExportFile {
  bucket: string
  key: string
  fileName: string
  sizeBytes: number | null
}

/** `<workspaceId>/<documentId>/exports/<exportId>.pdf`. */
export function documentExportStorageKey(
  workspaceId: string,
  documentId: string,
  exportId: string,
): string {
  return `${workspaceId}/${documentId}/exports/${exportId}.pdf`
}

/** `Proposta Comercial — Acme` → `proposta-comercial-acme.pdf`. */
export function documentPdfFileName(title: string): string {
  return `${slugify(title, 80) || 'documento'}.pdf`
}
