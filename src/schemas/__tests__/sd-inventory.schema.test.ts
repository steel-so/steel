import { describe, expect, it } from 'vitest'
import {
  CreateSdInventorySnmpTargetSchema,
  CreateSdInventoryTokenSchema,
  ListSdInventoryAlertsSchema,
  ListSdInventoryDevicesSchema,
  ListSdInventorySoftwareSchema,
  SdInventoryAgentIdSchema,
  SdInventoryReportSchema,
  SdInventoryTokenValueSchema,
  UpdateSdInventorySettingsSchema,
  UpdateSdInventorySnmpTargetSchema,
} from '../sd-inventory.schema'

const minimal = { agentId: 'abcdefgh1234', hostname: 'PC-01' }

describe('SdInventoryReportSchema', () => {
  it('fills defaults for a minimal report', () => {
    const parsed = SdInventoryReportSchema.parse(minimal)
    expect(parsed).toMatchObject({
      agentVersion: null,
      os: { name: null, version: null, arch: null },
      hardware: { manufacturer: null, serialNumber: null },
      ipAddresses: [],
      macAddresses: [],
      disks: [],
      software: [],
    })
  })

  it('trims text and turns empty strings into null', () => {
    const parsed = SdInventoryReportSchema.parse({
      ...minimal,
      hostname: '  PC-01  ',
      os: { name: '', version: ' 11 ', arch: 'amd64' },
      software: [{ name: ' Firefox ', publisher: '' }],
    })
    expect(parsed.hostname).toBe('PC-01')
    expect(parsed.os).toEqual({ name: null, version: '11', arch: 'amd64' })
    expect(parsed.software).toEqual([
      { name: 'Firefox', version: '', publisher: null },
    ])
  })

  it.each([
    ['short agent id', { agentId: 'abc' }],
    ['agent id with spaces', { agentId: 'abcdefgh 1234' }],
    ['empty hostname', { hostname: '  ' }],
    ['negative RAM', { hardware: { ramTotalMb: -1 } }],
    ['fractional RAM', { hardware: { ramTotalMb: 1.5 } }],
    ['disk without mount', { disks: [{ mount: '', totalMb: 1, usedMb: 0 }] }],
    ['software without name', { software: [{ name: '' }] }],
  ])('rejects %s', (_label, patch) => {
    expect(
      SdInventoryReportSchema.safeParse({ ...minimal, ...patch }).success,
    ).toBe(false)
  })

  it('caps the list sizes', () => {
    const disks = Array.from({ length: 65 }, (_, i) => ({
      mount: `/m${i}`,
      totalMb: 1,
      usedMb: 0,
    }))
    expect(
      SdInventoryReportSchema.safeParse({ ...minimal, disks }).success,
    ).toBe(false)
    const software = Array.from({ length: 5001 }, (_, i) => ({ name: `p${i}` }))
    expect(
      SdInventoryReportSchema.safeParse({ ...minimal, software }).success,
    ).toBe(false)
  })
})

describe('token schemas', () => {
  it('accepts base64url tokens and rejects the rest', () => {
    expect(SdInventoryTokenValueSchema.safeParse('A'.repeat(43)).success).toBe(
      true,
    )
    expect(SdInventoryTokenValueSchema.safeParse('short').success).toBe(false)
    expect(
      SdInventoryTokenValueSchema.safeParse(`${'A'.repeat(30)}!`).success,
    ).toBe(false)
    expect(SdInventoryAgentIdSchema.safeParse('a'.repeat(81)).success).toBe(
      false,
    )
  })

  it('requires a name to create a token', () => {
    expect(
      CreateSdInventoryTokenSchema.safeParse({ name: ' Matriz ' }).data,
    ).toEqual({
      name: 'Matriz',
    })
    expect(CreateSdInventoryTokenSchema.safeParse({ name: '' }).success).toBe(
      false,
    )
  })
})

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
