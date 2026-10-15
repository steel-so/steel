import { describe, expect, it } from 'vitest'
import { createEmailDocumentFromLayout } from '@/src/lib/canvas-email/convert-v1'
import {
  emailImageSchema,
  emailLinkSchema,
} from '@/src/lib/canvas-email/schemas'
import { createBuilderDocument } from '@/src/lib/crm-email-builder/layouts'
import {
  EmailCanvasDocumentSchema,
  EmailTemplateDocumentSchema,
} from '@/src/schemas/crm-email-builder.schema'
import {
  CreateCrmEmailTemplateSchema,
  UpdateCrmEmailTemplateSchema,
} from '@/src/schemas/crm-email-template.schema'

describe('e-mail canvas link and image props', () => {
  it.each([
    [{ type: 'url', value: 'https://a.example' }, true],
    [{ type: 'url', value: '{{campaign_link}}?x=1' }, true],
    [{ type: 'url', value: '' }, true],
    [{ type: 'url', value: 'javascript:alert(1)' }, false],
    [{ type: 'email', value: 'vendas@acme.example' }, true],
    [{ type: 'email', value: 'a b@x' }, false],
    [{ type: 'phone', value: '+5511999990000' }, true],
    [{ type: 'phone', value: '"><script>' }, false],
    [{ type: 'page', value: 'x' }, false],
  ])('%j → %s', (link, valid) => {
    expect(emailLinkSchema.safeParse(link).success).toBe(valid)
  })

  it.each([
    ['', true],
    ['https://cdn.example/a.png', true],
    ['{{logo_url}}', true],
    ['javascript:x', false],
    ['data:image/png;base64,AAA', false],
  ])('image src %s → %s', (src, valid) => {
    expect(emailImageSchema.safeParse({ src, alt: '' }).success).toBe(valid)
  })
})

describe('builder document schemas', () => {
  it('accepts a v2 envelope and caps the node count', () => {
    const doc = createEmailDocumentFromLayout('newsletter')
    expect(EmailCanvasDocumentSchema.safeParse(doc).success).toBe(true)
    expect(
      EmailCanvasDocumentSchema.safeParse({ ...doc, version: 3 }).success,
    ).toBe(false)
    const many = Object.fromEntries(
      Array.from({ length: 1501 }, (_, i) => [`n${i}`, { id: `n${i}` }]),
    )
    const result = EmailCanvasDocumentSchema.safeParse({ ...doc, nodes: many })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0].message).toContain('1500')
  })

  it('takes v1 or v2 on save', () => {
    expect(
      EmailTemplateDocumentSchema.safeParse(createBuilderDocument('promocao'))
        .success,
    ).toBe(true)
    expect(
      UpdateCrmEmailTemplateSchema.safeParse({
        builderDocument: createEmailDocumentFromLayout('promocao'),
      }).success,
    ).toBe(true)
    expect(
      UpdateCrmEmailTemplateSchema.safeParse({
        builderDocument: { version: 2 },
      }).success,
    ).toBe(false)
  })

  it('starts a builder template as v1 or v2', () => {
    const base = { name: 'N', subject: 'S', builderLayout: 'promocao' }
    expect(CreateCrmEmailTemplateSchema.safeParse(base).success).toBe(true)
    expect(
      CreateCrmEmailTemplateSchema.safeParse({ ...base, builderVersion: 2 })
        .success,
    ).toBe(true)
    expect(
      CreateCrmEmailTemplateSchema.safeParse({ ...base, builderVersion: 3 })
        .success,
    ).toBe(false)
  })
})
