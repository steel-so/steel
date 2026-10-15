import { describe, expect, it } from 'vitest'
import {
  clientIp,
  referrerHost,
  siteVisitorHash,
} from '@/src/lib/sites/visitor'

const base = {
  ip: '203.0.113.7',
  userAgent: 'Mozilla/5.0',
  siteId: 'site-1',
  secret: 'secret',
  now: new Date('2026-10-14T10:00:00Z'),
}

describe('site visitor', () => {
  it('hashes the same visitor to the same id within a UTC day', () => {
    const a = siteVisitorHash(base)
    expect(a).toMatch(/^[a-f0-9]{64}$/)
    expect(a).not.toContain(base.ip)
    expect(
      siteVisitorHash({ ...base, now: new Date('2026-10-14T23:59:00Z') }),
    ).toBe(a)
  })

  it('changes the id across days and sites', () => {
    const a = siteVisitorHash(base)
    expect(
      siteVisitorHash({ ...base, now: new Date('2026-10-15T00:00:00Z') }),
    ).not.toBe(a)
    expect(siteVisitorHash({ ...base, siteId: 'site-2' })).not.toBe(a)
  })

  it('keeps only the referrer host', () => {
    expect(referrerHost('https://www.google.com/search?q=cpf')).toBe(
      'www.google.com',
    )
    expect(
      referrerHost('https://clinica.sites.app/a', 'clinica.sites.app:443'),
    ).toBeNull()
    expect(referrerHost('https://other.app/a', 'clinica.sites.app')).toBe(
      'other.app',
    )
    expect(referrerHost('android-app://com.x')).toBeNull()
    expect(referrerHost('not a url')).toBeNull()
    expect(referrerHost(undefined)).toBeNull()
  })

  it('takes the first forwarded address', () => {
    expect(clientIp('203.0.113.7, 10.0.0.1')).toBe('203.0.113.7')
    expect(clientIp(null)).toBe('unknown')
    expect(clientIp(' ')).toBe('unknown')
  })
})
