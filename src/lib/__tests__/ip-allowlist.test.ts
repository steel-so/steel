import { describe, expect, it } from 'vitest'
import { isIpAllowed, isValidIpEntry } from '../ip-allowlist'

describe('isValidIpEntry', () => {
  it.each(['200.1.2.3', '200.1.2.0/24', '2001:db8::/32'])(
    'accepts %s',
    (entry) => expect(isValidIpEntry(entry)).toBe(true),
  )

  it.each([
    '',
    'abc',
    '200.1.2.3/33',
    '200.1.2.3/24/1',
    '2001:db8::/129',
    '200.1.2.3/x',
  ])('rejects %s', (entry) => expect(isValidIpEntry(entry)).toBe(false))
})

describe('isIpAllowed', () => {
  it('allows everything when the list is empty', () => {
    expect(isIpAllowed(null, [])).toBe(true)
    expect(isIpAllowed('1.2.3.4', [])).toBe(true)
  })

  it('matches single addresses and CIDR ranges', () => {
    const list = ['200.1.2.3', '10.20.0.0/16']
    expect(isIpAllowed('200.1.2.3', list)).toBe(true)
    expect(isIpAllowed('10.20.5.9', list)).toBe(true)
    expect(isIpAllowed('10.21.0.1', list)).toBe(false)
    expect(isIpAllowed('200.1.2.4', list)).toBe(false)
  })

  it('handles IPv4-mapped IPv6 and IPv6 ranges', () => {
    expect(isIpAllowed('::ffff:200.1.2.3', ['200.1.2.3'])).toBe(true)
    expect(isIpAllowed('2001:db8::1', ['2001:db8::/32'])).toBe(true)
    expect(isIpAllowed('2001:db9::1', ['2001:db8::/32'])).toBe(false)
  })

  it('fails closed on unknown or invalid IPs when restricted', () => {
    expect(isIpAllowed(null, ['200.1.2.3'])).toBe(false)
    expect(isIpAllowed('nope', ['200.1.2.3'])).toBe(false)
  })
})
