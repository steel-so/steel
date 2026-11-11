import {
  DEFAULT_DOCUMENT_SETTINGS,
  type DocumentSettingsDTO,
  DocumentSettingsSchema,
} from '@/src/schemas/document.schema'

/** Stored settings JSON → `DocumentSettingsDTO`, defaults when unreadable. */
export function parseDocumentSettings(value: unknown): DocumentSettingsDTO {
  const parsed = DocumentSettingsSchema.safeParse(value ?? {})
  return parsed.success ? parsed.data : DEFAULT_DOCUMENT_SETTINGS
}
