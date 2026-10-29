import { describe, expect, it } from 'vitest'
import {
  evaluateInventoryAlerts,
  expandInventoryRanges,
  isInventoryStale,
  normalizeMac,
  SD_INVENTORY_MAX_HOSTS,
  usagePercent,
} from '../servicedesk/inventory'

describe('usagePercent', () => {
  it('rounds the ratio and caps at 100', () => {
    expect(usagePercent(50, 200)).toBe(25)
    expect(usagePercent(2, 3)).toBe(67)
    expect(usagePercent(300, 200)).toBe(100)
  })

  it('returns 0 when the total or the usage is unknown', () => {
    expect(usagePercent(10, 0)).toBe(0)
    expect(usagePercent(0, 100)).toBe(0)
    expect(usagePercent(-5, 100)).toBe(0)
  })
})

describe('evaluateInventoryAlerts', () => {
  const thresholds = { diskThresholdPercent: 90, ramThresholdPercent: 85 }

  it('flags disks and RAM at or above the threshold', () => {
    const result = evaluateInventoryAlerts(
      {
        disks: [
          { mount: 'C:', totalMb: 1000, usedMb: 900 },
          { mount: 'D:', totalMb: 1000, usedMb: 100 },
        ],
        ramTotalMb: 1000,
        ramUsedMb: 850,
      },
      thresholds,
    )
    expect(result).toEqual([
      {
        kind: 'DISK',
        mount: 'C:',
        usedPercent: 90,
        threshold: 90,
        breached: true,
      },
      {
        kind: 'DISK',
        mount: 'D:',
        usedPercent: 10,
        threshold: 90,
        breached: false,
      },
      {
        kind: 'RAM',
        mount: '',
        usedPercent: 85,
        threshold: 85,
        breached: true,
      },
    ])
  })

  it('skips volumes without size and RAM without a total', () => {
    const result = evaluateInventoryAlerts(
      {
        disks: [{ mount: '/mnt/empty', totalMb: 0, usedMb: 0 }],
        ramTotalMb: null,
        ramUsedMb: null,
      },
      thresholds,
    )
    expect(result).toEqual([])
  })

  it('skips RAM when usage is unknown', () => {
    expect(
      evaluateInventoryAlerts(
        { disks: [], ramTotalMb: 1000, ramUsedMb: null },
        thresholds,
      ),
    ).toEqual([])
  })
})

describe('isInventoryStale', () => {
  const now = new Date('2026-10-10T00:00:00Z')

  it('is stale exactly at the limit and beyond', () => {
    expect(isInventoryStale(new Date('2026-10-03T00:00:00Z'), 7, now)).toBe(
      true,
    )
    expect(isInventoryStale(new Date('2026-09-01T00:00:00Z'), 7, now)).toBe(
      true,
    )
  })

  it('is fresh before the limit', () => {
    expect(isInventoryStale(new Date('2026-10-03T00:00:01Z'), 7, now)).toBe(
      false,
    )
  })

  it('uses the current time by default', () => {
    expect(isInventoryStale(new Date(), 1)).toBe(false)
  })
})

describe('expandInventoryRanges', () => {
  it('expands a /29 without network and broadcast', () => {
    const result = expandInventoryRanges(['10.0.0.8/29'])
    expect(result).toEqual({
      ok: true,
      hosts: [
        '10.0.0.9',
        '10.0.0.10',
        '10.0.0.11',
        '10.0.0.12',
        '10.0.0.13',
        '10.0.0.14',
      ],
    })
  })

  it('keeps both addresses of a /31 and the single address of a /32', () => {
    expect(expandInventoryRanges(['10.0.0.0/31'])).toEqual({
      ok: true,
      hosts: ['10.0.0.0', '10.0.0.1'],
    })
    expect(expandInventoryRanges(['10.0.0.5/32'])).toEqual({
      ok: true,
      hosts: ['10.0.0.5'],
    })
  })

  it('accepts bare IPs and dedupes across ranges', () => {
    const result = expandInventoryRanges(['10.0.0.1', '10.0.0.1', ' 10.0.0.2 '])
    expect(result).toEqual({ ok: true, hosts: ['10.0.0.1', '10.0.0.2'] })
  })

  it('aligns an unaligned base to its network', () => {
    const result = expandInventoryRanges(['192.168.1.77/30'])
    expect(result).toEqual({
      ok: true,
      hosts: ['192.168.1.77', '192.168.1.78'],
    })
  })

  it.each([
    ['not-an-ip'],
    ['10.0.0.256'],
    ['10.0.0'],
    ['10.0.0.0/33'],
    ['10.0.0.0/abc'],
    ['10.0.0.0/24/8'],
  ])('rejects %s', (range) => {
    const result = expandInventoryRanges([range])
    expect(result.ok).toBe(false)
  })

  it('rejects a range bigger than the host limit', () => {
    const result = expandInventoryRanges(['10.0.0.0/16'])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('grande demais')
  })

  it('rejects when the sum of ranges passes the limit', () => {
    const result = expandInventoryRanges(
      ['10.0.0.0/22', '10.0.4.0/29'],
      SD_INVENTORY_MAX_HOSTS,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('divida')
  })
})

describe('normalizeMac', () => {
  it('normalizes separators and case', () => {
    expect(normalizeMac('AA-BB-CC-DD-EE-FF')).toBe('aa:bb:cc:dd:ee:ff')
    expect(normalizeMac('aabb.ccdd.eeff')).toBe('aa:bb:cc:dd:ee:ff')
  })

  it('rejects anything that is not a MAC, or all zeros', () => {
    expect(normalizeMac('xyz')).toBeNull()
    expect(normalizeMac('00:00:00:00:00:00')).toBeNull()
    expect(normalizeMac('aa:bb:cc')).toBeNull()
  })
})
