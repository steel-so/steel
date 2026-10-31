import { describe, expect, it } from 'vitest'
import {
  cnpjKey,
  diceSimilarity,
  domainKey,
  emailKey,
  isGenericEmail,
  nameSimilarity,
  normalizeCompanyName,
  normalizeName,
  onlyDigits,
  phoneKey,
  sortedTokens,
} from '../crm-duplicates/normalize'

describe('normalizeName', () => {
  it('drops accents, case and punctuation', () => {
    expect(normalizeName('  José  da Silva-Júnior! ')).toBe(
      'jose da silva junior',
    )
  })

  it('handles empty values', () => {
    expect(normalizeName(null)).toBe('')
    expect(normalizeName(undefined)).toBe('')
  })
})

describe('normalizeCompanyName', () => {
  it('removes the legal form', () => {
    expect(normalizeCompanyName('ACME Comércio Ltda.')).toBe('acme comercio')
    expect(normalizeCompanyName('Beta S.A.')).toBe('beta')
  })
})

describe('sortedTokens and onlyDigits', () => {
  it('orders tokens', () => {
    expect(sortedTokens('silva maria')).toBe('maria silva')
  })

  it('keeps digits only', () => {
    expect(onlyDigits('(11) 98765-4321')).toBe('11987654321')
    expect(onlyDigits(null)).toBe('')
  })
})

describe('cnpjKey', () => {
  it('accepts formatted and plain CNPJs', () => {
    expect(cnpjKey('12.345.678/0001-95')).toBe('12345678000195')
    expect(cnpjKey('12345678000195')).toBe('12345678000195')
  })

  it('refuses short or repeated numbers', () => {
    expect(cnpjKey('123')).toBeNull()
    expect(cnpjKey('00000000000000')).toBeNull()
    expect(cnpjKey(null)).toBeNull()
  })
})

describe('domainKey', () => {
  it('strips protocol, www and path', () => {
    expect(domainKey('https://www.Acme.com.br/contato?x=1')).toBe('acme.com.br')
    expect(domainKey('acme.com.br:8080')).toBe('acme.com.br')
  })

  it('refuses values that are not a host', () => {
    expect(domainKey('acme')).toBeNull()
    expect(domainKey('')).toBeNull()
    expect(domainKey(null)).toBeNull()
  })
})

describe('emailKey', () => {
  it('lower-cases valid e-mails and refuses the rest', () => {
    expect(emailKey(' Ana@Acme.COM ')).toBe('ana@acme.com')
    expect(emailKey('not-an-email')).toBeNull()
    expect(emailKey(null)).toBeNull()
  })

  it('flags shared mailboxes', () => {
    expect(isGenericEmail('contato@acme.com')).toBe(true)
    expect(isGenericEmail('ana@acme.com')).toBe(false)
  })
})

describe('phoneKey', () => {
  it('meets national, international and old/new ninth digit forms', () => {
    const a = phoneKey('(11) 98765-4321')
    expect(a).toBe('1187654321')
    expect(phoneKey('+55 11 98765 4321')).toBe(a)
    expect(phoneKey('11 8765-4321')).toBe(a)
  })

  it('keeps short local numbers by their last 8 digits', () => {
    expect(phoneKey('98765-4321')).toBe('87654321')
  })

  it('refuses too short or repeated numbers', () => {
    expect(phoneKey('1234')).toBeNull()
    expect(phoneKey('00000000')).toBeNull()
    expect(phoneKey(null)).toBeNull()
  })
})

describe('similarity', () => {
  it('scores equal, close and distant names', () => {
    expect(diceSimilarity('maria silva', 'maria silva')).toBe(1)
    expect(diceSimilarity('maria silva', 'maria silvaa')).toBeGreaterThan(0.85)
    expect(diceSimilarity('maria silva', 'pedro santos')).toBeLessThan(0.3)
    expect(diceSimilarity('', 'x')).toBe(0)
  })

  it('ignores token order', () => {
    expect(nameSimilarity('silva maria', 'maria silva')).toBe(1)
  })
})
