import { describe, expect, it } from 'vitest'
import {
  isValidPageSlug,
  isValidSiteSlug,
  joinPagePath,
  pageSlugFromTitle,
  siteSlugFromName,
  slugify,
  slugWithSuffix,
} from '@/src/lib/sites/slug'

describe('site slugs', () => {
  it.each([
    ['clinica', true],
    ['clinica-sao-lucas', true],
    ['a1b', true],
    ['ab', false],
    ['-clinica', false],
    ['clinica-', false],
    ['Clinica', false],
    ['xn--clinica', false],
    ['www', false],
    ['api', false],
    ['a'.repeat(64), false],
    ['a'.repeat(63), true],
  ])('isValidSiteSlug(%s) → %s', (slug, expected) => {
    expect(isValidSiteSlug(slug)).toBe(expected)
  })

  it.each([
    ['contato', true],
    ['quem-somos', true],
    ['quem--somos', false],
    ['Contato', false],
    ['a'.repeat(81), false],
  ])('isValidPageSlug(%s) → %s', (slug, expected) => {
    expect(isValidPageSlug(slug)).toBe(expected)
  })

  it('slugifies accents, spaces and symbols', () => {
    expect(slugify('Clínica São Lucas!')).toBe('clinica-sao-lucas')
    expect(slugify('  --Olá   Mundo--  ')).toBe('ola-mundo')
    expect(slugify('abc-def', 4)).toBe('abc')
  })

  it('derives a valid site slug from any name', () => {
    expect(siteSlugFromName('Clínica São Lucas')).toBe('clinica-sao-lucas')
    expect(siteSlugFromName('AB')).toBe('ab-site')
    expect(siteSlugFromName('www')).toBe('www-site')
    expect(siteSlugFromName('!!!')).toBe('meu-site')
    expect(siteSlugFromName('xn--abc')).toBe('xn-abc')
  })

  it('suffixes a slug and keeps it within 63 characters', () => {
    expect(slugWithSuffix('clinica', 1)).toBe('clinica')
    expect(slugWithSuffix('clinica', 3)).toBe('clinica-3')
    const long = slugWithSuffix(`${'a'.repeat(60)}-b`, 12)
    expect(long).toHaveLength(63)
    expect(long.endsWith('-12')).toBe(true)
    expect(slugWithSuffix(`${'a'.repeat(60)}-bc`, 7)).toBe(
      `${'a'.repeat(60)}-7`,
    )
  })

  it('derives page slugs and joins paths', () => {
    expect(pageSlugFromTitle('Quem somos')).toBe('quem-somos')
    expect(pageSlugFromTitle('???')).toBe('pagina')
    expect(joinPagePath(null, 'contato')).toBe('contato')
    expect(joinPagePath('servicos', 'consultoria')).toBe('servicos/consultoria')
  })
})
