import { describe, expect, it } from 'vitest'
import { headingFragment } from '@/src/__tests__/factories/crm-email-editor.factory'
import { MAX_FRAGMENT_NODES } from '@/src/lib/canvas-email/fragments'
import {
  CreateCrmEmailSavedBlockSchema,
  CreateCrmEmailTemplateVersionSchema,
  CrmEmailAiRewriteSchema,
  CrmEmailAiSectionSchema,
  CrmEmailContactListsQuerySchema,
  EMAIL_SAVED_BLOCK_CATEGORIES,
  ListCrmEmailSavedBlocksQuerySchema,
  UpdateCrmEmailSavedBlockSchema,
} from '../crm-email-editor.schema'

describe('saved block schemas', () => {
  it('accepts a named fragment and defaults the category', () => {
    const parsed = CreateCrmEmailSavedBlockSchema.parse({
      name: '  Cabeçalho ',
      fragment: headingFragment(),
    })
    expect(parsed.name).toBe('Cabeçalho')
    expect(parsed.category).toBe('Outros')
    expect(EMAIL_SAVED_BLOCK_CATEGORIES).toContain('Outros')
  })

  it('refuses empty names, oversized fragments and http thumbnails', () => {
    expect(
      CreateCrmEmailSavedBlockSchema.safeParse({
        name: ' ',
        fragment: headingFragment(),
      }).success,
    ).toBe(false)
    const nodes: Record<string, object> = {}
    for (let i = 0; i <= MAX_FRAGMENT_NODES; i++) nodes[`n${i}`] = {}
    expect(
      CreateCrmEmailSavedBlockSchema.safeParse({
        name: 'x',
        fragment: { rootId: 'n0', nodes },
      }).success,
    ).toBe(false)
    expect(
      CreateCrmEmailSavedBlockSchema.safeParse({
        name: 'x',
        fragment: headingFragment(),
        thumbnail: 'http://x.com/a.png',
      }).success,
    ).toBe(false)
    expect(
      CreateCrmEmailSavedBlockSchema.safeParse({
        name: 'x',
        fragment: headingFragment(),
        thumbnail: 'https://x.com/a.png',
      }).success,
    ).toBe(true)
  })

  it('needs a name or a category to update', () => {
    expect(UpdateCrmEmailSavedBlockSchema.safeParse({}).success).toBe(false)
    expect(
      UpdateCrmEmailSavedBlockSchema.safeParse({ category: 'Chamadas' })
        .success,
    ).toBe(true)
  })

  it('bounds the search query', () => {
    expect(ListCrmEmailSavedBlocksQuerySchema.parse({ q: ' cab ' }).q).toBe(
      'cab',
    )
    expect(
      ListCrmEmailSavedBlocksQuerySchema.safeParse({ q: 'x'.repeat(81) })
        .success,
    ).toBe(false)
  })
})

describe('version and AI schemas', () => {
  it('takes an optional version label', () => {
    expect(CreateCrmEmailTemplateVersionSchema.parse({})).toEqual({})
    expect(
      CreateCrmEmailTemplateVersionSchema.safeParse({ label: 'x'.repeat(81) })
        .success,
    ).toBe(false)
  })

  it('defaults the rewrite fields and validates the mode', () => {
    expect(
      CrmEmailAiRewriteSchema.parse({
        blockType: 'email.heading',
        mode: 'shorter',
      }),
    ).toEqual({
      blockType: 'email.heading',
      mode: 'shorter',
      text: '',
      prompt: '',
      subject: '',
    })
    expect(
      CrmEmailAiRewriteSchema.safeParse({
        blockType: 'email.heading',
        mode: 'louder',
      }).success,
    ).toBe(false)
  })

  it('needs a request or a product to generate a section', () => {
    expect(CrmEmailAiSectionSchema.safeParse({}).success).toBe(false)
    expect(CrmEmailAiSectionSchema.safeParse({ productId: 'p1' }).success).toBe(
      true,
    )
    expect(CrmEmailAiSectionSchema.safeParse({ prompt: 'x' }).success).toBe(
      true,
    )
  })

  it('needs a person for the contact lists', () => {
    expect(CrmEmailContactListsQuerySchema.safeParse({}).success).toBe(false)
    expect(
      CrmEmailContactListsQuerySchema.safeParse({ personId: 'p1' }).success,
    ).toBe(true)
  })
})
