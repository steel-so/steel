import { describe, expect, it } from 'vitest'
import { SiteSettingsSchema } from '../site.schema'
import {
  GenerateSiteSchema,
  InspirationLinkSchema,
  SITE_AI_MAX_INSPIRATION_LINKS,
} from '../site-ai.schema'

const base = {
  name: 'Pão & Cia',
  business: 'Padaria artesanal com fermentação natural',
  goal: 'leads',
  tone: 'friendly',
}

describe('GenerateSiteSchema — inspiration and model (ADR 0071)', () => {
  it('defaults to no links, no focus and the workspace model', () => {
    const parsed = GenerateSiteSchema.parse(base)
    expect(parsed.inspirationLinks).toEqual([])
    expect(parsed.inspirationFocus).toBe('')
    expect(parsed.modelKey).toBeUndefined()
  })

  it('accepts up to five http(s) links and drops duplicates', () => {
    const links = [
      'https://a.example.com/',
      'http://b.example.com/page?x=1',
      'https://c.example.com:443/',
      'http://d.example.com:80/',
      'https://a.example.com/',
    ]
    const parsed = GenerateSiteSchema.parse({
      ...base,
      inspirationLinks: links,
    })
    expect(parsed.inspirationLinks).toHaveLength(4)
  })

  it('refuses a sixth link', () => {
    const links = Array.from(
      { length: SITE_AI_MAX_INSPIRATION_LINKS + 1 },
      (_, i) => `https://s${i}.example.com/`,
    )
    const result = GenerateSiteSchema.safeParse({
      ...base,
      inspirationLinks: links,
    })
    expect(result.success).toBe(false)
  })

  it.each([
    'exemplo',
    'ftp://example.com/',
    'javascript:alert(1)',
    'file:///etc/passwd',
    'https://user:pass@example.com/',
    'https://example.com:8443/',
    'http://localhost/',
    '   ',
    `https://example.com/${'a'.repeat(2000)}`,
  ])('refuses the link %s', (link) => {
    expect(InspirationLinkSchema.safeParse(link).success).toBe(false)
  })

  it('trims the focus and caps it', () => {
    expect(
      GenerateSiteSchema.parse({ ...base, inspirationFocus: '  cores  ' })
        .inspirationFocus,
    ).toBe('cores')
    expect(
      GenerateSiteSchema.safeParse({
        ...base,
        inspirationFocus: 'x'.repeat(301),
      }).success,
    ).toBe(false)
  })

  it('accepts only known model keys', () => {
    expect(
      GenerateSiteSchema.parse({ ...base, modelKey: 'openai:gpt-5-mini' })
        .modelKey,
    ).toBe('openai:gpt-5-mini')
    expect(
      GenerateSiteSchema.safeParse({ ...base, modelKey: 'openai:gpt-99' })
        .success,
    ).toBe(false)
    expect(
      GenerateSiteSchema.safeParse({ ...base, modelKey: 'whatever' }).success,
    ).toBe(false)
  })
})

describe('SiteSettingsSchema.aiGeneration', () => {
  it('is absent by default and survives a round trip', () => {
    expect(SiteSettingsSchema.parse({}).aiGeneration).toBeUndefined()
    const parsed = SiteSettingsSchema.parse({
      aiGeneration: { modelKey: 'openai:gpt-5-mini', inspirationLinks: 2 },
    })
    expect(parsed.aiGeneration).toEqual({
      modelKey: 'openai:gpt-5-mini',
      inspirationLinks: 2,
      inspirationRead: 0,
    })
  })

  it('reads a malformed block as absent instead of resetting the settings', () => {
    const parsed = SiteSettingsSchema.parse({ aiGeneration: 'oops' })
    expect(parsed.aiGeneration).toBeUndefined()
  })
})
