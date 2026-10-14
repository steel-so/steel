import { describe, expect, it } from 'vitest'
import {
  CreateWikiPageSchema,
  MoveWikiPageSchema,
  UpdateWikiPageSchema,
  WIKI_AI_MAX_TEXT,
  WikiAiSchema,
  WikiPublicTokenSchema,
} from '../wiki-page.schema'

function makeContentOfSize(targetBytes: number) {
  return [{ type: 'p', children: [{ text: 'x'.repeat(targetBytes) }] }]
}

describe('CreateWikiPageSchema', () => {
  it('should default title to empty string', () => {
    const result = CreateWikiPageSchema.safeParse({})

    expect(result.success).toBe(true)
    expect(result.data?.title).toBe('')
  })

  it('should accept a title and parentId', () => {
    const result = CreateWikiPageSchema.safeParse({
      title: 'Onboarding',
      parentId: 'tz4a98xxat96iws9zmbrgj3a',
    })

    expect(result.success).toBe(true)
  })

  it('should reject title longer than 255 characteres', () => {
    const result = CreateWikiPageSchema.safeParse({ title: 'x'.repeat(256) })

    expect(result.success).toBe(false)
  })

  it('should reject an invalid parentId', () => {
    const result = CreateWikiPageSchema.safeParse({ parentId: 'not-a-cuid' })

    expect(result.success).toBe(false)
  })
})

describe('UpdateWikiPageSchema', () => {
  it('should accept empty object (all optional)', () => {
    const result = UpdateWikiPageSchema.safeParse({})

    expect(result.success).toBe(true)
  })

  it('should accept content within size limit', () => {
    const result = UpdateWikiPageSchema.safeParse({
      content: makeContentOfSize(150_000),
    })

    expect(result.success).toBe(false)
  })

  it('should accept icon set to null (clearing it)', () => {
    const result = UpdateWikiPageSchema.safeParse({ icon: null })

    expect(result.success).toBe(true)
  })
})

describe('MoveWikiPageSchema', () => {
  it('should accept parentId null (move to root)', () => {
    const result = MoveWikiPageSchema.safeParse({
      parentId: null,
      position: 0,
    })

    expect(result.success).toBe(true)
  })

  it('should reject missing position', () => {
    const result = MoveWikiPageSchema.safeParse({
      parentId: null,
    })

    expect(result.success).toBe(false)
  })
})

describe('WikiAiSchema', () => {
  it('accepts every action with trimmed text', () => {
    for (const action of [
      'paraphrase',
      'simplify',
      'elaborate',
      'summarize',
      'title',
    ] as const) {
      expect(WikiAiSchema.parse({ action, text: '  oi  ' })).toEqual({
        action,
        text: 'oi',
      })
    }
  })

  it('rejects an unknown action, empty text and text over the cap', () => {
    expect(
      WikiAiSchema.safeParse({ action: 'translate', text: 'x' }).success,
    ).toBe(false)
    expect(
      WikiAiSchema.safeParse({ action: 'title', text: '  ' }).success,
    ).toBe(false)
    expect(
      WikiAiSchema.safeParse({
        action: 'summarize',
        text: 'x'.repeat(WIKI_AI_MAX_TEXT + 1),
      }).success,
    ).toBe(false)
  })
})

describe('WikiPublicTokenSchema', () => {
  it('accepts 32 base64url chars only', () => {
    expect(
      WikiPublicTokenSchema.safeParse(`${'aZ09_-'.repeat(5)}ab`).success,
    ).toBe(true)
    expect(WikiPublicTokenSchema.safeParse('a'.repeat(31)).success).toBe(false)
    expect(WikiPublicTokenSchema.safeParse(`${'a'.repeat(31)}/`).success).toBe(
      false,
    )
  })
})
