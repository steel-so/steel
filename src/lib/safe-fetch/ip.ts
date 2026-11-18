import { BlockList, isIP } from 'node:net'

/**
 * Address policy of the server-side fetcher: only globally routable unicast
 * addresses pass. Loopback, private (RFC 1918), CGNAT, link-local (cloud
 * metadata lives at 169.254.169.254 / fd00:ec2::254), documentation,
 * benchmarking, multicast and reserved ranges are refused, for IPv4 and IPv6.
 * IPv6 forms that carry an IPv4 address (IPv4-mapped, IPv4-compatible,
 * NAT64, 6to4) are judged by the embedded IPv4 address, so `::ffff:7f00:1`
 * cannot smuggle loopback in.
 */

const blocked = new BlockList()

const V4_RANGES: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3],
]
for (const [network, prefix] of V4_RANGES) {
  blocked.addSubnet(network, prefix, 'ipv4')
}

const V6_RANGES: Array<[string, number]> = [
  ['::', 128],
  ['::1', 128],
  ['100::', 64],
  ['2001::', 32],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
]
for (const [network, prefix] of V6_RANGES) {
  blocked.addSubnet(network, prefix, 'ipv6')
}

/** Expands an IPv6 literal to its eight 16-bit groups; `null` if malformed. */
export function expandIpv6(address: string): number[] | null {
  let text = address.toLowerCase()
  const zone = text.indexOf('%')
  if (zone !== -1) text = text.slice(0, zone)
  const tail = text.match(/(\d+\.\d+\.\d+\.\d+)$/)
  if (tail) {
    const parts = tail[1].split('.').map(Number)
    if (parts.length !== 4 || parts.some((part) => part > 255)) return null
    const high = ((parts[0] << 8) | parts[1]).toString(16)
    const low = ((parts[2] << 8) | parts[3]).toString(16)
    text = `${text.slice(0, -tail[1].length)}${high}:${low}`
  }
  const halves = text.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const missing = 8 - head.length - rest.length
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null
  const fill: string[] = halves.length === 2 ? Array(missing).fill('0') : []
  const numbers = [...head, ...fill, ...rest].map((group) =>
    /^[0-9a-f]{1,4}$/.test(group) ? Number.parseInt(group, 16) : Number.NaN,
  )
  return numbers.length === 8 && numbers.every((n) => !Number.isNaN(n))
    ? numbers
    : null
}

function v4FromGroups(high: number, low: number): string {
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`
}

/** IPv4 address hidden inside an IPv6 one, when the form carries one. */
function embeddedV4(groups: number[]): string | null {
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups
  const zeros = (count: number) =>
    groups.slice(0, count).every((group) => group === 0)
  // ::ffff:a.b.c.d (mapped) and ::a.b.c.d (compatible)
  if ((zeros(5) && g5 === 0xffff) || zeros(6)) return v4FromGroups(g6, g7)
  // ::ffff:0:a.b.c.d (SIIT)
  if (zeros(4) && g4 === 0xffff && g5 === 0) return v4FromGroups(g6, g7)
  // 64:ff9b::/96 and 64:ff9b:1::/48 (NAT64)
  if (
    g0 === 0x64 &&
    g1 === 0xff9b &&
    (g2 === 1 || (g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0))
  ) {
    return v4FromGroups(g6, g7)
  }
  // 2002::/16 (6to4): the IPv4 address follows the prefix
  if (g0 === 0x2002) return v4FromGroups(g1, g2)
  return null
}

/** True when the address must not be contacted (also when unparsable). */
export function isBlockedAddress(address: string): boolean {
  const text = address
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
  const version = isIP(text)
  if (version === 4) return blocked.check(text, 'ipv4')
  if (version === 6) {
    const groups = expandIpv6(text)
    if (!groups) return true
    const inner = embeddedV4(groups)
    if (inner) return isBlockedAddress(inner)
    return blocked.check(groups.map((g) => g.toString(16)).join(':'), 'ipv6')
  }
  return true
}

const BLOCKED_HOST_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.localdomain',
  '.home.arpa',
  '.lan',
]

/** Host names that are local by convention, before any DNS lookup. */
export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  return (
    host === 'localhost' ||
    host === 'metadata' ||
    BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))
  )
}
