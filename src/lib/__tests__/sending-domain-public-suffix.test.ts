import { describe, expect, it } from 'vitest'
import {
  isPublicSuffix,
  registrableDomain,
} from '../sending-domain/public-suffix'

describe('isPublicSuffix', () => {
  it('flags single labels and known multi-label suffixes', () => {
    expect(isPublicSuffix('com')).toBe(true)
    expect(isPublicSuffix('com.br')).toBe(true)
    expect(isPublicSuffix('CO.UK')).toBe(true)
  })

  it('lets real domains through', () => {
    expect(isPublicSuffix('acme.com.br')).toBe(false)
    expect(isPublicSuffix('news.acme.com')).toBe(false)
    expect(isPublicSuffix('acme.io')).toBe(false)
  })
})

describe('registrableDomain', () => {
  it('keeps two labels for plain TLDs', () => {
    expect(registrableDomain('news.acme.com')).toBe('acme.com')
    expect(registrableDomain('a.b.acme.io')).toBe('acme.io')
    expect(registrableDomain('acme.com')).toBe('acme.com')
  })

  it('keeps three labels under a multi-label suffix', () => {
    expect(registrableDomain('news.acme.com.br')).toBe('acme.com.br')
    expect(registrableDomain('mail.x.acme.co.uk')).toBe('acme.co.uk')
    expect(registrableDomain('Acme.COM.BR')).toBe('acme.com.br')
  })
})
