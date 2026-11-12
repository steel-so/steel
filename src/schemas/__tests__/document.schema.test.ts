import { describe, expect, it } from 'vitest'
import {
  AcceptDocumentSchema,
  CreateDocumentImportSchema,
  CreateDocumentSchema,
  DEFAULT_DOCUMENT_SETTINGS,
  DocumentContentSchema,
  DocumentFieldValuesSchema,
  DocumentRecipientInputSchema,
  DocumentThemeSchema,
  DocumentTrackSchema,
  ListDocumentsQuerySchema,
  SendDocumentSchema,
} from '@/src/schemas/document.schema'

describe('document schemas', () => {
  it('defaults the settings', () => {
    expect(DEFAULT_DOCUMENT_SETTINGS).toMatchObject({
      layout: 'web',
      pageSize: 'A4',
      orientation: 'portrait',
      allowDownload: true,
      requireIdentification: false,
    })
  })

  it('creates with defaults and rejects an empty title', () => {
    const parsed = CreateDocumentSchema.parse({ title: ' Proposta ' })
    expect(parsed).toMatchObject({
      title: 'Proposta',
      kind: 'OTHER',
      isTemplate: false,
    })
    expect(CreateDocumentSchema.safeParse({ title: ' ' }).success).toBe(false)
  })

  it('caps content and theme size', () => {
    expect(DocumentContentSchema.safeParse({ a: 1 }).success).toBe(true)
    const huge = { a: 'x'.repeat(2_000_001) }
    expect(DocumentContentSchema.safeParse(huge).success).toBe(false)
    expect(DocumentThemeSchema.safeParse({ a: 'x' }).success).toBe(true)
    const bigTheme = { a: 'x'.repeat(64_001) }
    expect(DocumentThemeSchema.safeParse(bigTheme).success).toBe(false)
  })

  it('parses the list query flags', () => {
    expect(ListDocumentsQuerySchema.parse({}).isTemplate).toBe(false)
    const query = ListDocumentsQuerySchema.parse({ isTemplate: 'true' })
    expect(query).toMatchObject({ isTemplate: true, page: 1, pageSize: 25 })
  })

  it('derives the channel from the filled contact (only one allowed)', () => {
    const base = { name: 'Maria' }
    const parse = (input: object) =>
      DocumentRecipientInputSchema.safeParse(input)
    expect(parse(base).data?.channel).toBe('LINK')
    expect(parse({ ...base, email: 'm@x.com' }).data?.channel).toBe('EMAIL')
    expect(parse({ ...base, phone: '11988887777' }).data?.channel).toBe(
      'WHATSAPP',
    )
    expect(
      parse({ ...base, email: 'm@x.com', phone: '11988887777' }).success,
    ).toBe(false)
    const sent = SendDocumentSchema.parse({
      recipients: [{ ...base, email: 'm@x.com' }],
    })
    expect(sent.recipients).toHaveLength(1)
  })

  it('requires the agreement on accept', () => {
    const input = { name: 'Maria', versionId: 'v1' }
    const agreed = { ...input, agreed: true }
    expect(AcceptDocumentSchema.safeParse(input).success).toBe(false)
    expect(AcceptDocumentSchema.safeParse(agreed).success).toBe(true)
  })

  it('caps the number of field answers', () => {
    const keys = Array.from({ length: 201 }, (_, i) => `f${i}`)
    const many = Object.fromEntries(keys.map((key) => [key, 'x']))
    expect(DocumentFieldValuesSchema.safeParse(many).success).toBe(false)
    expect(DocumentFieldValuesSchema.safeParse({ f: true }).success).toBe(true)
  })

  it('validates a tracking beacon', () => {
    const beacon = DocumentTrackSchema.parse({
      sessionKey: 'session-123',
      visitorId: 'visitor-123',
      activeMs: 15_000,
      scrollPct: 40,
    })
    expect(beacon).toMatchObject({ sections: {}, entered: [], first: false })
  })

  it('requires a prompt for AI generation', () => {
    const parse = (input: object) =>
      CreateDocumentImportSchema.safeParse(input).success
    expect(parse({ mode: 'PROMPT' })).toBe(false)
    expect(parse({ mode: 'PROMPT', prompt: 'Termo' })).toBe(true)
    expect(parse({ mode: 'PDF' })).toBe(true)
  })
})
