import {
  DEFAULT_DOCUMENT_SETTINGS,
  type DocumentSettingsDTO,
  DocumentSettingsSchema,
} from '@/src/schemas/document.schema'

/** Stored settings (JSON) with the defaults filled; invalid → defaults. */
export function parseDocumentSettings(value: unknown): DocumentSettingsDTO {
  const parsed = DocumentSettingsSchema.safeParse(value ?? {})
  return parsed.success ? parsed.data : { ...DEFAULT_DOCUMENT_SETTINGS }
}

/**
 * `UpdateDocumentSchema.settings` is a `.partial()` of a schema with
 * defaults, so Zod fills every absent key with its default. Keep only the
 * keys the client actually sent, so a PATCH of one setting does not reset
 * the others.
 */
export function pickSentSettings(
  parsed: Partial<DocumentSettingsDTO> | undefined,
  raw: unknown,
): Partial<DocumentSettingsDTO> | undefined {
  if (!parsed) return undefined
  if (typeof raw !== 'object' || raw === null) return undefined
  const sent = new Set(Object.keys(raw))
  const picked: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(parsed)) {
    if (sent.has(key)) picked[key] = value
  }
  return picked as Partial<DocumentSettingsDTO>
}
