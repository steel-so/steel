import { describe, expect, it } from 'vitest'
import {
  formatBrPhone,
  normalizeEmail,
  splitPhones,
  uniqueEmails,
  uniquePhones,
} from '../cnpj/contacts'

describe('normalizeEmail()', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Foo@Bar.COM.br ')).toBe('foo@bar.com.br')
  })

  it.each([null, undefined, '', 'foo', 'foo@bar', 'a b@c.com', '@x.com'])(
    'rejects %s',
    (raw) => {
      expect(normalizeEmail(raw)).toBeNull()
    },
  )
})

describe('formatBrPhone()', () => {
  it.each([
    ['1123958400', '(11) 2395-8400'],
    ['11999990000', '(11) 99999-0000'],
    ['+55 (11) 2395-8400', '(11) 2395-8400'],
    ['5511999990000', '(11) 99999-0000'],
  ])('formats %s', (raw, out) => {
    expect(formatBrPhone(raw)).toBe(out)
  })

  it.each([
    null,
    '',
    '123',
    '1111111111',
    '00000000000',
    '112395840',
    '551123958400123',
  ])('rejects %s', (raw) => {
    expect(formatBrPhone(raw)).toBeNull()
  })
})

describe('lists', () => {
  it('splits on / , ;', () => {
    expect(
      splitPhones('(11) 2395-8400 / (11) 2395-8401; 1133334444, '),
    ).toEqual(['(11) 2395-8400 ', ' (11) 2395-8401', ' 1133334444'])
  })

  it('dedupes by normalized value keeping order', () => {
    expect(uniqueEmails(['A@b.com', 'x', 'a@b.com'])).toEqual(['a@b.com'])
    expect(uniquePhones(['1123958400 / (11) 2395-8400', '1133334444'])).toEqual(
      ['(11) 2395-8400', '(11) 3333-4444'],
    )
  })
})
