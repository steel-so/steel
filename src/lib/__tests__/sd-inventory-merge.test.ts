import { describe, expect, it } from 'vitest'
import {
  findMergeMatch,
  matchReason,
  normalizeHostname,
  normalizeSerial,
  pickPrimary,
  type SdInventoryMergeIdentity,
  unionValues,
} from '../servicedesk/inventory-merge'

function device(
  overrides?: Partial<SdInventoryMergeIdentity>,
): SdInventoryMergeIdentity {
  return {
    id: 'a',
    source: 'AGENT',
    hostname: 'PC-RECEPCAO',
    serialNumber: 'SN-0001',
    macAddresses: ['aa:bb:cc:dd:ee:ff'],
    ...overrides,
  }
}

describe('normalizeSerial', () => {
  it('lowercases and trims', () => {
    expect(normalizeSerial('  ABC-1234 ')).toBe('abc-1234')
  })

  it('drops factory placeholders, short and repeated values', () => {
    for (const junk of [
      null,
      undefined,
      '',
      '0',
      'None',
      'To Be Filled By O.E.M.',
      'Default string',
      'abc',
      '0000000',
    ]) {
      expect(normalizeSerial(junk)).toBeNull()
    }
  })
})

describe('normalizeHostname', () => {
  it('keeps the first label in lowercase', () => {
    expect(normalizeHostname('PC-01.empresa.local')).toBe('pc-01')
  })

  it('refuses IPs, generic and too short names', () => {
    for (const value of [
      null,
      undefined,
      '',
      '10.0.0.1',
      'localhost',
      'localhost.localdomain',
      'pc',
      'switch',
    ]) {
      expect(normalizeHostname(value)).toBeNull()
    }
  })
})

describe('matchReason', () => {
  it('matches by serial, ignoring case', () => {
    expect(
      matchReason(
        device(),
        device({ id: 'b', serialNumber: 'sn-0001', macAddresses: [] }),
      ),
    ).toBe('serial')
  })

  it('never merges two different serials, whatever else matches', () => {
    expect(
      matchReason(device(), device({ id: 'b', serialNumber: 'SN-9999' })),
    ).toBeNull()
  })

  it('matches by any shared MAC, in any notation', () => {
    expect(
      matchReason(
        device({ serialNumber: null }),
        device({
          id: 'b',
          serialNumber: null,
          hostname: 'outro',
          macAddresses: ['11:22:33:44:55:66', 'AA-BB-CC-DD-EE-FF'],
        }),
      ),
    ).toBe('mac')
  })

  it('matches by hostname label when there is no stronger sign', () => {
    expect(
      matchReason(
        device({ serialNumber: null, macAddresses: [] }),
        device({
          id: 'b',
          serialNumber: null,
          macAddresses: [],
          hostname: 'pc-recepcao.empresa.local',
        }),
      ),
    ).toBe('hostname')
  })

  it('does not match different machines', () => {
    expect(
      matchReason(
        device({ serialNumber: null, macAddresses: ['not-a-mac'] }),
        device({
          id: 'b',
          serialNumber: null,
          hostname: 'pc-diretoria',
          macAddresses: [],
        }),
      ),
    ).toBeNull()
  })
})

describe('findMergeMatch', () => {
  it('ignores itself and the same source', () => {
    const me = device()
    expect(
      findMergeMatch(me, [me, device({ id: 'b', source: 'AGENT' })]),
    ).toBeNull()
  })

  it('prefers the strongest reason among candidates', () => {
    const byName = device({
      id: 'name',
      source: 'SNMP',
      serialNumber: null,
      macAddresses: [],
    })
    const bySerial = device({
      id: 'serial',
      source: 'DISCOVERY',
      hostname: 'x-1234',
      macAddresses: [],
    })
    const found = findMergeMatch(device(), [byName, bySerial])
    expect(found?.candidate.id).toBe('serial')
    expect(found?.reason).toBe('serial')
  })

  it('keeps the first of equally strong reasons', () => {
    const first = device({ id: 'one', source: 'SNMP' })
    const second = device({ id: 'two', source: 'DISCOVERY' })
    expect(findMergeMatch(device(), [first, second])?.candidate.id).toBe('one')
  })

  it('returns null with no candidates', () => {
    expect(findMergeMatch(device(), [])).toBeNull()
  })
})

describe('pickPrimary', () => {
  it('ranks agent over SNMP over discovery', () => {
    const agent = device()
    const snmp = device({ id: 'b', source: 'SNMP' })
    const discovered = device({ id: 'c', source: 'DISCOVERY' })
    expect(pickPrimary(snmp, agent).primary).toBe(agent)
    expect(pickPrimary(agent, snmp).primary).toBe(agent)
    expect(pickPrimary(discovered, snmp).primary).toBe(snmp)
    expect(pickPrimary(snmp, discovered)).toEqual({
      primary: snmp,
      secondary: discovered,
    })
  })

  it('keeps the first on a tie', () => {
    const a = device()
    const b = device({ id: 'b' })
    expect(pickPrimary(a, b).primary).toBe(a)
  })
})

describe('unionValues', () => {
  it('merges without repeating, keeping order', () => {
    expect(unionValues(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c'])
  })
})
