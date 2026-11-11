// AI import of CRM > Documentos (ADR 0063): what "Importar PDF" and
// "Gerar com IA" show before starting. The import itself is
// `DocumentImportDTO` (types/document.d.ts).

export interface DocumentImportQuotaDTO {
  usedUsd: number
  quotaUsd: number
  remainingUsd: number
  exceeded: boolean
}

export interface DocumentImportContextDTO {
  available: boolean
  /** pt-BR reason when `available` is false. */
  unavailableReason: string | null
  /** Whether the model reads the PDF itself (else its extracted text). */
  nativePdf: boolean
  maxBytes: number
  maxPages: number
  quota: DocumentImportQuotaDTO
  /** Estimated cost (US$) with the workspace's model; null without one. */
  estimate: {
    model: string
    baseUsd: number
    pageUsd: number
    promptUsd: number
  } | null
}
