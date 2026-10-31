import { describe, expect, it } from 'vitest'
import {
  CreateSdInventoryDiscoveryRangeSchema,
  CreateSdInventorySnmpTargetSchema,
  ListSdInventoryAlertsSchema,
  ListSdInventoryDevicesSchema,
  ListSdInventorySoftwareSchema,
  MergeSdInventoryDeviceSchema,
  UpdateSdInventoryDiscoveryRangeSchema,
  UpdateSdInventorySettingsSchema,
  UpdateSdInventorySnmpTargetSchema,
} from '../sd-inventory.schema'

describe('UpdateSdInventorySettingsSchema', () => {
  it('accepts partial updates inside the allowed ranges', () => {
    expect(
      UpdateSdInventorySettingsSchema.parse({ diskThresholdPercent: 80 }),
    ).toEqual({
      diskThresholdPercent: 80,
    })
    expect(
      UpdateSdInventorySettingsSchema.parse({ defaultTypeId: null }),
    ).toEqual({
      defaultTypeId: null,
    })
  })

  it.each([
    [{}],
    [{ diskThresholdPercent: 49 }],
    [{ ramThresholdPercent: 101 }],
    [{ staleAfterDays: 0 }],
    [{ staleAfterDays: 366 }],
  ])('rejects %j', (body) => {
    expect(UpdateSdInventorySettingsSchema.safeParse(body).success).toBe(false)
  })
})

describe('SNMP target schemas', () => {
  const base = { name: 'Matriz', ranges: ['10.0.0.0/24'], community: 'public' }

  it('applies defaults on create', () => {
    expect(CreateSdInventorySnmpTargetSchema.parse(base)).toMatchObject({
      port: 161,
      intervalMinutes: 1440,
      active: true,
    })
  })

  it.each([
    ['no ranges', { ranges: [] }],
    ['invalid range', { ranges: ['nope'] }],
    ['too big a range', { ranges: ['10.0.0.0/16'] }],
    [
      'too many ranges',
      { ranges: Array.from({ length: 21 }, (_, i) => `10.0.${i}.1`) },
    ],
    ['empty community', { community: '' }],
    ['port zero', { port: 0 }],
    ['interval under 15 min', { intervalMinutes: 5 }],
    ['interval over 7 days', { intervalMinutes: 10_081 }],
  ])('rejects %s', (_label, patch) => {
    expect(
      CreateSdInventorySnmpTargetSchema.safeParse({ ...base, ...patch })
        .success,
    ).toBe(false)
  })

  it('reports the range problem on the ranges field', () => {
    const result = CreateSdInventorySnmpTargetSchema.safeParse({
      ...base,
      ranges: ['10.0.0.0/16'],
    })
    expect(result.success).toBe(false)
    if (!result.success)
      expect(result.error.issues[0]?.message).toContain('grande demais')
  })

  it('needs at least one field to update and lets the community be omitted', () => {
    expect(UpdateSdInventorySnmpTargetSchema.safeParse({}).success).toBe(false)
    expect(UpdateSdInventorySnmpTargetSchema.parse({ active: false })).toEqual({
      active: false,
    })
  })
})

describe('list query schemas', () => {
  it('coerces pagination and booleans from the query string', () => {
    expect(
      ListSdInventoryDevicesSchema.parse({
        page: '2',
        pageSize: '50',
        hasAlert: 'true',
        stale: 'false',
      }),
    ).toMatchObject({ page: 2, pageSize: 50, hasAlert: true, stale: false })
    expect(ListSdInventoryDevicesSchema.parse({})).toMatchObject({
      page: 1,
      pageSize: 25,
    })
    expect(
      ListSdInventoryDevicesSchema.safeParse({ pageSize: '101' }).success,
    ).toBe(false)
    expect(
      ListSdInventoryDevicesSchema.safeParse({ source: 'USB' }).success,
    ).toBe(false)
  })

  it('parses alert and software filters', () => {
    expect(
      ListSdInventoryAlertsSchema.parse({ status: 'OPEN', kind: 'RAM' }),
    ).toMatchObject({
      status: 'OPEN',
      kind: 'RAM',
      limit: 50,
    })
    expect(ListSdInventoryAlertsSchema.safeParse({ kind: 'CPU' }).success).toBe(
      false,
    )
    expect(
      ListSdInventorySoftwareSchema.parse({ search: ' fire ' }),
    ).toMatchObject({
      search: 'fire',
      page: 1,
    })
  })
})

describe('SNMPv3 targets', () => {
  const v3 = {
    name: 'Core',
    ranges: ['10.0.0.0/30'],
    snmpVersion: 'V3' as const,
    v3Username: 'monitor',
  }

  it('defaults to v2c and still requires a community there', () => {
    const base = { name: 'a', ranges: ['10.0.0.1'] }
    expect(CreateSdInventorySnmpTargetSchema.safeParse(base).success).toBe(
      false,
    )
    expect(
      CreateSdInventorySnmpTargetSchema.parse({ ...base, community: 'public' })
        .snmpVersion,
    ).toBe('V2C')
  })

  it('accepts v3 with and without keys', () => {
    expect(CreateSdInventorySnmpTargetSchema.safeParse(v3).success).toBe(true)
    expect(
      CreateSdInventorySnmpTargetSchema.safeParse({
        ...v3,
        v3AuthProtocol: 'SHA256',
        v3AuthKey: 'auth-secret-1',
        v3PrivProtocol: 'AES256B',
        v3PrivKey: 'priv-secret-1',
      }).success,
    ).toBe(true)
  })

  it('requires the username, 8+ character keys and authentication for privacy', () => {
    const fails = (patch: object) =>
      CreateSdInventorySnmpTargetSchema.safeParse({ ...v3, ...patch }).success
    expect(fails({ v3Username: undefined })).toBe(false)
    expect(fails({ v3AuthKey: 'short' })).toBe(false)
    expect(fails({ v3PrivKey: 'priv-secret-1' })).toBe(false)
    expect(fails({ v3AuthProtocol: 'SHA999' })).toBe(false)
    expect(fails({ v3PrivProtocol: 'ROT13', v3AuthKey: 'auth-secret-1' })).toBe(
      false,
    )
  })

  it('lets an update omit every secret', () => {
    expect(
      UpdateSdInventorySnmpTargetSchema.safeParse({ snmpVersion: 'V3' })
        .success,
    ).toBe(true)
    expect(
      UpdateSdInventorySnmpTargetSchema.safeParse({ v3AuthKey: 'x' }).success,
    ).toBe(false)
  })
})

describe('discovery ranges', () => {
  const base = { name: 'VLAN de estações', cidr: '10.0.1.0/24' }

  it('is opt-in: disabled unless the admin turns it on', () => {
    expect(CreateSdInventoryDiscoveryRangeSchema.parse(base)).toMatchObject({
      enabled: false,
      intervalMinutes: 1440,
    })
    expect(
      CreateSdInventoryDiscoveryRangeSchema.parse({ ...base, enabled: true })
        .enabled,
    ).toBe(true)
  })

  it('only accepts private networks of at most 1024 hosts', () => {
    const ok = (cidr: string) =>
      CreateSdInventoryDiscoveryRangeSchema.safeParse({ ...base, cidr }).success
    expect(ok('192.168.0.0/22')).toBe(true)
    expect(ok('8.8.8.0/24')).toBe(false)
    expect(ok('10.0.0.0/8')).toBe(false)
    expect(ok('10.0.0.0/33')).toBe(false)
    expect(ok('lixo')).toBe(false)
  })

  it('enforces a one hour minimum interval', () => {
    const interval = (intervalMinutes: number) =>
      CreateSdInventoryDiscoveryRangeSchema.safeParse({
        ...base,
        intervalMinutes,
      }).success
    expect(interval(60)).toBe(true)
    expect(interval(59)).toBe(false)
    expect(interval(10_081)).toBe(false)
  })

  it('validates updates and refuses an empty one', () => {
    expect(
      UpdateSdInventoryDiscoveryRangeSchema.safeParse({ enabled: true })
        .success,
    ).toBe(true)
    expect(UpdateSdInventoryDiscoveryRangeSchema.safeParse({}).success).toBe(
      false,
    )
    expect(
      UpdateSdInventoryDiscoveryRangeSchema.safeParse({ cidr: '1.1.1.0/24' })
        .success,
    ).toBe(false)
  })
})

describe('merge and device filters', () => {
  it('needs the target device id', () => {
    expect(MergeSdInventoryDeviceSchema.safeParse({}).success).toBe(false)
    expect(MergeSdInventoryDeviceSchema.parse({ intoId: 'dev-1' })).toEqual({
      intoId: 'dev-1',
    })
  })

  it('lists discovered devices on demand and accepts the DISCOVERY source', () => {
    expect(ListSdInventoryDevicesSchema.parse({}).discovered).toBe(false)
    expect(
      ListSdInventoryDevicesSchema.parse({
        discovered: 'true',
        source: 'DISCOVERY',
      }),
    ).toMatchObject({ discovered: true, source: 'DISCOVERY' })
  })
})
