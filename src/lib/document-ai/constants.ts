import type { AiModelDefinition } from '@/src/lib/ai/models'

/**
 * AI import of CRM > Documentos (ADR 0063, docs/documents/README.md): the
 * shared names of the upload, the worker and the UI.
 */

/** Private MinIO bucket of the documents module (imports and PDF exports). */
export const DOCUMENT_FILES_BUCKET = 'documents'

export const DOCUMENT_IMPORT_PDF_TYPE = 'application/pdf'
export const DOCUMENT_IMPORT_DOCX_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

/** `accept` of the file input. */
export const DOCUMENT_IMPORT_ACCEPT = [
  DOCUMENT_IMPORT_PDF_TYPE,
  DOCUMENT_IMPORT_DOCX_TYPE,
  '.pdf',
  '.docx',
].join(',')

/** `<workspaceId>/imports/<importId>/<file>` — the name kept readable. */
export function documentImportKey(
  workspaceId: string,
  importId: string,
  fileName: string,
): string {
  const safe = fileName.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80) || 'file'
  return `${workspaceId}/imports/${importId}/${safe}`
}

/** Display name without path, at most 255 chars. */
export function documentImportFileName(fileName: string): string {
  const base = fileName.replace(/^.*[\\/]/, '').trim()
  return (base || 'arquivo').slice(0, 255)
}

/**
 * Extracted text sent to the model, at most (~75k tokens). A 60-page
 * document rarely gets close; past it the end is cut and the user is told.
 */
export const DOCUMENT_IMPORT_MAX_TEXT_CHARS = 300_000

/**
 * Models that read a PDF natively (text and page images): every current
 * Claude model, and the OpenAI models with vision in the catalog. Any other
 * model gets the text of each page instead.
 */
const OPENAI_PDF_MODELS = new Set([
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4.1',
  'gpt-4.1-mini',
  'gpt-5',
  'gpt-5-mini',
])

export function acceptsPdfInput(
  model: Pick<AiModelDefinition, 'provider' | 'model'>,
): boolean {
  if (model.provider === 'anthropic') return model.model.startsWith('claude-')
  return OPENAI_PDF_MODELS.has(model.model)
}

/**
 * Output cap of the outline call. A faithful 60-page document is long, so
 * the cap is the most the model allows (bounded), not the usual 16k.
 */
const MAX_OUTPUT_BY_MODEL: Record<string, number> = {
  'gpt-4o-mini': 16_000,
  'gpt-4o': 16_000,
  'gpt-4.1-mini': 32_000,
  'gpt-4.1': 32_000,
  'claude-haiku-4-5': 48_000,
}
const DEFAULT_MAX_OUTPUT = 48_000

export function outlineMaxTokens(model: Pick<AiModelDefinition, 'model'>) {
  return MAX_OUTPUT_BY_MODEL[model.model] ?? DEFAULT_MAX_OUTPUT
}

/** Model calls per import: the first answer plus one repair turn. */
export const DOCUMENT_AI_MAX_ATTEMPTS = 2
