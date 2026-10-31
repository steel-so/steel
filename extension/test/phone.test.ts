import { describe, expect, it } from 'vitest'
import { canonicalPhone, digitsOf, fullPhone, looksLikePhone, phonesMatch, toE164 } from '../src/lib/phone'

describe('digitsOf', () => {
  it('keeps only the digits', () => {
    expect(digitsOf('+55 (11) 91234-5678')).toBe('5511912345678')
  })
})

describe('canonicalPhone', () => {
  it('keeps a full number with the country code', () => {
    expect(canonicalPhone('+55 21 3456-7890')).toBe('552134567890')
  })

  it('assumes Brazil for 10 and 11 digit numbers', () => {
    expect(canonicalPhone('21 3456-7890')).toBe('552134567890')
    expect(canonicalPhone('(11) 91234-5678')).toBe('551112345678')
  })

  it('drops the ninth digit of a Brazilian mobile', () => {
    expect(canonicalPhone('5511912345678')).toBe('551112345678')
  })

  it('leaves foreign numbers alone', () => {
    expect(canonicalPhone('+1 415 555 0132')).toBe('14155550132')
  })

  it('rejects what cannot be a phone', () => {
    expect(canonicalPhone('1234567')).toBeNull()
    expect(canonicalPhone('1234567890123456')).toBeNull()
    expect(canonicalPhone('abc')).toBeNull()
  })
})

describe('phonesMatch', () => {
  it('matches the same line with and without the ninth digit', () => {
    expect(phonesMatch('+55 11 91234-5678', '(11) 1234-5678')).toBe(true)
  })

  it('does not match different numbers', () => {
    expect(phonesMatch('5511912345678', '5511912345679')).toBe(false)
  })

  it('never matches an invalid value', () => {
    expect(phonesMatch('12', '12')).toBe(false)
  })
})

describe('looksLikePhone', () => {
  it('accepts a number as WhatsApp shows it', () => {
    expect(looksLikePhone('+55 11 91234-5678')).toBe(true)
  })

  it('rejects names, short numbers and mixed text', () => {
    expect(looksLikePhone('Maria Silva')).toBe(false)
    expect(looksLikePhone('12345')).toBe(false)
    expect(looksLikePhone('Loja 24 horas 11 91234 5678')).toBe(false)
  })
})

describe('fullPhone', () => {
  it('adds Brazil to local numbers and keeps the rest', () => {
    expect(fullPhone('(11) 91234-5678')).toBe('5511912345678')
    expect(fullPhone('+1 415 555 0132')).toBe('14155550132')
    expect(fullPhone('12')).toBeNull()
  })
})

describe('toE164', () => {
  it('prefixes the country code and the plus sign', () => {
    expect(toE164('(11) 91234-5678')).toBe('+5511912345678')
    expect(toE164('+1 415 555 0132')).toBe('+14155550132')
  })

  it('rejects an invalid number', () => {
    expect(toE164('123')).toBeNull()
  })
})
