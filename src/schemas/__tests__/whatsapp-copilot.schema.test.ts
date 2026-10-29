import { describe, expect, it } from 'vitest'
import {
  AdjustWhatsAppCopilotToneSchema,
  SuggestWhatsAppCopilotReplySchema,
} from '../whatsapp-copilot.schema'

describe('SuggestWhatsAppCopilotReplySchema', () => {
  it('accepts no hint and drops a blank one', () => {
    expect(SuggestWhatsAppCopilotReplySchema.parse({}).hint).toBeUndefined()
    expect(
      SuggestWhatsAppCopilotReplySchema.parse({ hint: '   ' }).hint,
    ).toBeUndefined()
  })

  it('trims the hint and caps its size', () => {
    expect(SuggestWhatsAppCopilotReplySchema.parse({ hint: ' oi ' }).hint).toBe(
      'oi',
    )
    expect(
      SuggestWhatsAppCopilotReplySchema.safeParse({ hint: 'a'.repeat(501) })
        .success,
    ).toBe(false)
  })
})

describe('AdjustWhatsAppCopilotToneSchema', () => {
  it('accepts a draft with a known tone', () => {
    expect(
      AdjustWhatsAppCopilotToneSchema.parse({ text: ' oi ', tone: 'FORMAL' }),
    ).toEqual({ text: 'oi', tone: 'FORMAL' })
  })

  it('rejects blank text, unknown tones and oversized drafts', () => {
    expect(
      AdjustWhatsAppCopilotToneSchema.safeParse({ text: ' ', tone: 'FORMAL' })
        .success,
    ).toBe(false)
    expect(
      AdjustWhatsAppCopilotToneSchema.safeParse({ text: 'oi', tone: 'X' })
        .success,
    ).toBe(false)
    expect(
      AdjustWhatsAppCopilotToneSchema.safeParse({
        text: 'a'.repeat(4097),
        tone: 'DIRECT',
      }).success,
    ).toBe(false)
  })
})
