import { describe, expect, it, vi } from 'vitest'
import {
  createPacer,
  type DiscoveryDeps,
  discoverHosts,
  isPrivateInventoryRange,
  parseProcNetArp,
} from '../servicedesk/discovery'

function deps(overrides?: Partial<DiscoveryDeps>): DiscoveryDeps {
  let clock = 0
  return {
    probe: vi.fn(async () => false),
    readArp: vi.fn(async () => new Map<string, string>()),
    reverse: vi.fn(async () => null),
    sleep: vi.fn(async (ms: number) => {
      clock += ms
    }),
    now: () => clock,
    ...overrides,
  }
}

describe('isPrivateInventoryRange', () => {
  it('accepts RFC 1918, CGNAT and link-local blocks', () => {
    for (const range of [
      '10.0.0.0/8',
      '10.20.30.0/24',
      '172.16.0.0/12',
      '172.31.255.1',
      '192.168.1.0/24',
      '100.64.0.0/10',
      '169.254.10.0/24',
    ]) {
      expect(isPrivateInventoryRange(range)).toBe(true)
    }
  })

  it('refuses public space, ranges that spill out of a private block and garbage', () => {
    for (const range of [
      '8.8.8.0/24',
      '172.32.0.0/24',
      '172.0.0.0/8',
      '192.168.0.0/15',
      '0.0.0.0/0',
      '10.0.0.0/33',
      '10.0.0.0/x',
      'nope',
    ]) {
      expect(isPrivateInventoryRange(range)).toBe(false)
    }
  })
})

describe('parseProcNetArp', () => {
  const sample = [
    'IP address       HW type     Flags       HW address            Mask     Device',
    '10.0.0.1         0x1         0x2         aa:bb:cc:dd:ee:01     *        eth0',
    '10.0.0.2         0x1         0x0         aa:bb:cc:dd:ee:02     *        eth0',
    '10.0.0.3         0x1         0x2         00:00:00:00:00:00     *        eth0',
    '10.0.0.4         0x1         0x2         AA:BB:CC:DD:EE:04     *        eth0',
    'short line',
  ].join('\n')

  it('keeps only complete entries with a real MAC, normalized', () => {
    expect([...parseProcNetArp(sample)]).toEqual([
      ['10.0.0.1', 'aa:bb:cc:dd:ee:01'],
      ['10.0.0.4', 'aa:bb:cc:dd:ee:04'],
    ])
  })
})

describe('createPacer', () => {
  it('spaces probe starts to the per-second cap', async () => {
    const d = deps()
    const pace = createPacer(10, d)
    await pace()
    await pace()
    await pace()
    expect(d.sleep).toHaveBeenCalledTimes(2)
    expect(vi.mocked(d.sleep).mock.calls.map(([ms]) => ms)).toEqual([100, 100])
  })
})

describe('discoverHosts', () => {
  it('reports the hosts that answered with their ARP MAC and reverse name', async () => {
    const d = deps({
      probe: vi.fn(async (ip: string) => ip !== '10.0.0.2'),
      readArp: vi.fn(async () => new Map([['10.0.0.1', 'aa:bb:cc:dd:ee:01']])),
      reverse: vi.fn(async (ip: string) =>
        ip === '10.0.0.1' ? 'impressora.local' : null,
      ),
    })
    const result = await discoverHosts(
      ['10.0.0.1', '10.0.0.2', '10.0.0.3'],
      d,
      { concurrency: 2, perSecond: 1000 },
    )
    expect(result.probed).toBe(3)
    expect(result.found).toEqual([
      {
        ip: '10.0.0.1',
        mac: 'aa:bb:cc:dd:ee:01',
        hostname: 'impressora.local',
      },
      { ip: '10.0.0.3', mac: null, hostname: null },
    ])
    expect(d.readArp).toHaveBeenCalledTimes(1)
    expect(d.reverse).toHaveBeenCalledTimes(2)
  })

  it('paces the sweep and respects the concurrency', async () => {
    let running = 0
    let peak = 0
    const d = deps({
      probe: vi.fn(async () => {
        running++
        peak = Math.max(peak, running)
        await Promise.resolve()
        running--
        return false
      }),
    })
    const hosts = Array.from({ length: 8 }, (_, i) => `10.0.0.${i + 1}`)
    await discoverHosts(hosts, d, { concurrency: 3, perSecond: 4 })
    expect(peak).toBeLessThanOrEqual(3)
    expect(d.sleep).toHaveBeenCalled()
  })

  it('survives a probe, ARP or reverse lookup that throws', async () => {
    const d = deps({
      probe: vi.fn(async (ip: string) => {
        if (ip === '10.0.0.1') throw new Error('boom')
        return true
      }),
      readArp: vi.fn(async () => {
        throw new Error('no arp')
      }),
      reverse: vi.fn(async () => {
        throw new Error('no dns')
      }),
    })
    const result = await discoverHosts(['10.0.0.1', '10.0.0.2'], d)
    expect(result.found).toEqual([
      { ip: '10.0.0.2', mac: null, hostname: null },
    ])
  })

  it('handles an empty host list', async () => {
    const result = await discoverHosts([], deps())
    expect(result).toEqual({ found: [], probed: 0 })
  })
})
