import { describe, expect, it } from 'vitest'
import {
  toDisplayPhone,
  toStoredPhone,
  withBrazilianNinthDigit,
} from '@/src/lib/phone-br'

describe('toStoredPhone', () => {
  it('adds 55 to DDD + number', () => {
    expect(toStoredPhone('(11) 98888-7777')).toBe('5511988887777')
    expect(toStoredPhone('1133334444')).toBe('551133334444')
  })
  it('keeps numbers that already carry a country code', () => {
    expect(toStoredPhone('+55 11 98888-7777')).toBe('5511988887777')
    expect(toStoredPhone('+1 415 555 0100')).toBe('14155550100')
  })
  it('returns null for empty input', () => {
    expect(toStoredPhone('')).toBeNull()
    expect(toStoredPhone(null)).toBeNull()
    expect(toStoredPhone('abc')).toBeNull()
  })
})

describe('toDisplayPhone', () => {
  it('hides the 55 and masks progressively', () => {
    expect(toDisplayPhone('5511988887777')).toBe('(11) 98888-7777')
    expect(toDisplayPhone('551133334444')).toBe('(11) 3333-4444')
    expect(toDisplayPhone('11988887777')).toBe('(11) 98888-7777')
    expect(toDisplayPhone('1')).toBe('(1')
    expect(toDisplayPhone('113')).toBe('(11) 3')
    expect(toDisplayPhone('')).toBe('')
  })
})

describe('withBrazilianNinthDigit', () => {
  it('inserts the 9 after the DDD of a 12-digit mobile', () => {
    expect(withBrazilianNinthDigit('554899976392')).toBe('5548999976392')
    expect(withBrazilianNinthDigit('551165432100')).toBe('5511965432100')
    expect(withBrazilianNinthDigit('551187654321')).toBe('5511987654321')
  })

  it('keeps a number that already has the 9', () => {
    expect(withBrazilianNinthDigit('5548999976392')).toBe('5548999976392')
  })

  it('keeps landlines (first digit 2-5)', () => {
    expect(withBrazilianNinthDigit('554832451234')).toBe('554832451234')
    expect(withBrazilianNinthDigit('551123456789')).toBe('551123456789')
    expect(withBrazilianNinthDigit('551153456789')).toBe('551153456789')
  })

  it('keeps non-Brazilian numbers and other lengths', () => {
    expect(withBrazilianNinthDigit('14155550100')).toBe('14155550100')
    expect(withBrazilianNinthDigit('447911123456')).toBe('447911123456')
    expect(withBrazilianNinthDigit('5511')).toBe('5511')
    expect(withBrazilianNinthDigit('55119999999999')).toBe('55119999999999')
    expect(withBrazilianNinthDigit('')).toBe('')
  })

  it('keeps a BSUID and formatted text', () => {
    expect(withBrazilianNinthDigit('BR.13491208655302741918')).toBe(
      'BR.13491208655302741918',
    )
    expect(withBrazilianNinthDigit('+554899976392')).toBe('+554899976392')
  })
})
