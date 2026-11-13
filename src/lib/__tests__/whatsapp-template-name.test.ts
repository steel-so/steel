import { describe, expect, it } from 'vitest'
import { templateNameFromTitle } from '../whatsapp/template-name'
import { translateTemplateRejection } from '../whatsapp/template-rejection'

describe('templateNameFromTitle()', () => {
  it('drops accents, lowercases and joins words with underscores', () => {
    expect(templateNameFromTitle('Confirmação de Exame')).toBe(
      'confirmacao_de_exame',
    )
  })

  it('collapses punctuation and trims separators', () => {
    expect(templateNameFromTitle('  Oferta!!! -- 50% off  ')).toBe(
      'oferta_50_off',
    )
  })

  it('returns an empty string when nothing usable is left', () => {
    expect(templateNameFromTitle('???')).toBe('')
  })

  it('caps the length at the Meta limit', () => {
    expect(templateNameFromTitle('a'.repeat(600))).toHaveLength(512)
  })
})

describe('translateTemplateRejection()', () => {
  it('returns null when there is no reason', () => {
    expect(translateTemplateRejection(null)).toBeNull()
    expect(translateTemplateRejection('   ')).toBeNull()
  })

  it.each([
    ['INVALID_FORMAT', /variáveis/],
    ['ABUSIVE_CONTENT', /abusivo/],
    ['SCAM', /golpe/],
    ['TAG_CONTENT_MISMATCH', /categoria/],
    ['NONE', /não informou/],
  ])('translates %s', (code, expected) => {
    expect(translateTemplateRejection(code)).toMatch(expected)
  })

  it('keeps an unknown reason as Meta wrote it', () => {
    expect(translateTemplateRejection('Something else entirely')).toBe(
      'Something else entirely',
    )
  })
})
