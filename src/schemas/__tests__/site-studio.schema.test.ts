import { describe, expect, it } from 'vitest'
import {
  CreateSiteFromTemplateSchema,
  DuplicateSiteSchema,
  RemoveSiteMediaSchema,
} from '../site-studio.schema'

describe('site studio schemas', () => {
  it('accepts a known template and rejects unknown ones', () => {
    expect(
      CreateSiteFromTemplateSchema.safeParse({
        name: ' Clínica ',
        templateId: 'agencia',
      }),
    ).toMatchObject({ success: true, data: { name: 'Clínica' } })
    expect(
      CreateSiteFromTemplateSchema.safeParse({ name: 'x', templateId: 'nope' })
        .success,
    ).toBe(false)
    expect(
      CreateSiteFromTemplateSchema.safeParse({
        name: '',
        templateId: 'agencia',
      }).success,
    ).toBe(false)
  })

  it('takes an optional name when duplicating', () => {
    expect(DuplicateSiteSchema.safeParse({}).success).toBe(true)
    expect(DuplicateSiteSchema.safeParse({ name: '' }).success).toBe(false)
  })

  it('only accepts uploaded file names as media ids', () => {
    expect(
      RemoveSiteMediaSchema.safeParse({
        id: '3f0c8a52-5a1e-4c55-9d0a-0c9f2f1b7a10.webp',
      }).success,
    ).toBe(true)
    for (const id of ['../x.png', 'ws/a.png', 'a.svg']) {
      expect(RemoveSiteMediaSchema.safeParse({ id }).success).toBe(false)
    }
  })
})
