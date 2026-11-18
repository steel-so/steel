import { describe, expect, it } from 'vitest'
import {
  expandIpv6,
  isBlockedAddress,
  isBlockedHostname,
} from '@/src/lib/safe-fetch/ip'

describe('isBlockedAddress', () => {
  it.each([
    ['0.0.0.0', 'unspecified'],
    ['10.1.2.3', 'RFC 1918 /8'],
    ['100.64.0.1', 'CGNAT'],
    ['127.0.0.1', 'loopback'],
    ['127.255.255.254', 'loopback range end'],
    ['169.254.169.254', 'cloud metadata'],
    ['172.16.0.1', 'RFC 1918 /12 start'],
    ['172.31.255.255', 'RFC 1918 /12 end'],
    ['192.0.0.8', 'IETF protocol assignments'],
    ['192.0.2.10', 'documentation'],
    ['192.168.1.1', 'RFC 1918 /16'],
    ['198.18.0.1', 'benchmarking'],
    ['198.51.100.7', 'documentation'],
    ['203.0.113.9', 'documentation'],
    ['224.0.0.1', 'multicast'],
    ['255.255.255.255', 'broadcast'],
    ['::', 'IPv6 unspecified'],
    ['::1', 'IPv6 loopback'],
    ['0:0:0:0:0:0:0:1', 'IPv6 loopback, expanded'],
    ['fe80::1', 'IPv6 link-local'],
    ['fc00::1', 'IPv6 unique local'],
    ['fd00:ec2::254', 'AWS IPv6 metadata'],
    ['ff02::1', 'IPv6 multicast'],
    ['2001:db8::1', 'IPv6 documentation'],
    ['2001:0:4136:e378:8000:63bf:3fff:fdd2', 'Teredo'],
    ['::ffff:127.0.0.1', 'IPv4-mapped loopback'],
    ['::ffff:7f00:1', 'IPv4-mapped loopback, hex form'],
    ['::ffff:10.0.0.1', 'IPv4-mapped private'],
    ['::ffff:a9fe:a9fe', 'IPv4-mapped metadata, hex form'],
    ['::127.0.0.1', 'IPv4-compatible loopback'],
    ['64:ff9b::7f00:1', 'NAT64 to loopback'],
    ['64:ff9b::a00:1', 'NAT64 to private'],
    ['2002:7f00:1::1', '6to4 to loopback'],
    ['2002:c0a8:101::1', '6to4 to 192.168.1.1'],
    ['[::1]', 'bracketed IPv6'],
    ['not-an-ip', 'garbage fails closed'],
    ['', 'empty fails closed'],
    ['1.2.3', 'short IPv4 fails closed'],
  ])('blocks %s (%s)', (address) => {
    expect(isBlockedAddress(address)).toBe(true)
  })

  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '93.184.216.34',
    '172.15.255.255',
    '172.32.0.1',
    '100.63.255.255',
    '100.128.0.1',
    '198.17.255.255',
    '198.20.0.1',
    '223.255.255.254',
    '2606:4700:4700::1111',
    '2001:4860:4860::8888',
    '::ffff:8.8.8.8',
    '64:ff9b::808:808',
    '2002:808:808::1',
  ])('allows the public address %s', (address) => {
    expect(isBlockedAddress(address)).toBe(false)
  })
})

describe('expandIpv6', () => {
  it('expands compressed forms and dotted tails', () => {
    expect(expandIpv6('::1')).toEqual([0, 0, 0, 0, 0, 0, 0, 1])
    expect(expandIpv6('1::')).toEqual([1, 0, 0, 0, 0, 0, 0, 0])
    expect(expandIpv6('::ffff:1.2.3.4')).toEqual([
      0, 0, 0, 0, 0, 0xffff, 0x102, 0x304,
    ])
    expect(expandIpv6('fe80::1%eth0')).toEqual([0xfe80, 0, 0, 0, 0, 0, 0, 1])
  })

  it('rejects malformed addresses', () => {
    expect(expandIpv6('1:2:3')).toBeNull()
    expect(expandIpv6('1::2::3')).toBeNull()
    expect(expandIpv6('::g')).toBeNull()
    expect(expandIpv6('1:2:3:4:5:6:7:8:9')).toBeNull()
    expect(expandIpv6('::1.2.3.256')).toBeNull()
  })
})

describe('isBlockedHostname', () => {
  it.each([
    'localhost',
    'LOCALHOST.',
    'app.localhost',
    'printer.local',
    'db.internal',
    'metadata.google.internal',
    'router.lan',
    'host.localdomain',
    'metadata',
  ])('blocks %s', (host) => {
    expect(isBlockedHostname(host)).toBe(true)
  })

  it.each(['example.com', 'sub.example.com.br', 'localhost.example.com'])(
    'allows %s',
    (host) => {
      expect(isBlockedHostname(host)).toBe(false)
    },
  )
})
