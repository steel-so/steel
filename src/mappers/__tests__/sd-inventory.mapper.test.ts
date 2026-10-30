import { describe, expect, it } from 'vitest'
import {
  createFakeSdInventoryAgentRelease,
  createFakeSdInventoryDiscoveryRange,
} from '@/src/__tests__/factories/nov-inventory-followups.factory'
import {
  createFakeSdInventoryAlert,
  createFakeSdInventoryDevice,
  createFakeSdInventoryDeviceDetail,
  createFakeSdInventorySettings,
  createFakeSdInventoryTarget,
  createFakeSdInventoryToken,
} from '@/src/__tests__/factories/nov-s1-asset-inventory.factory'
import {
  parseSdInventoryDisks,
  SD_INVENTORY_DEFAULT_SETTINGS,
  toSdInventoryAgentReleaseDTO,
  toSdInventoryAlertDTO,
  toSdInventoryDeviceDetailDTO,
  toSdInventoryDeviceDTO,
  toSdInventoryDiscoveryRangeDTO,
  toSdInventorySettingsDTO,
  toSdInventorySnmpTargetDTO,
  toSdInventorySoftwareCatalogRowDTO,
  toSdInventoryTokenDTO,
  toSdInventoryTokenWithValueDTO,
} from '../sd-inventory.mapper'

const NOW = new Date('2026-10-20T12:00:00.000Z')

describe('toSdInventorySettingsDTO', () => {
  it('falls back to the defaults when the workspace saved nothing', () => {
    const dto = toSdInventorySettingsDTO(null)
    expect(dto).toEqual(SD_INVENTORY_DEFAULT_SETTINGS)
    expect(dto).not.toBe(SD_INVENTORY_DEFAULT_SETTINGS)
  })

  it('maps the stored row', () => {
    expect(
      toSdInventorySettingsDTO(
        createFakeSdInventorySettings({
          diskThresholdPercent: 80,
          defaultTypeId: 't1',
        }),
      ),
    ).toEqual({
      diskThresholdPercent: 80,
      ramThresholdPercent: 90,
      staleAfterDays: 7,
      syncConfigItems: true,
      defaultTypeId: 't1',
      agentAutoUpdate: false,
    })
  })
})

describe('parseSdInventoryDisks', () => {
  it('computes the percent and drops malformed entries', () => {
    expect(
      parseSdInventoryDisks([
        { mount: '/', totalMb: 1000, usedMb: 250, fs: 'ext4', label: 'root' },
        { mount: '/x' },
        { totalMb: 1 },
        null,
        'oops',
      ]),
    ).toEqual([
      {
        mount: '/',
        label: 'root',
        fs: 'ext4',
        totalMb: 1000,
        usedMb: 250,
        usedPercent: 25,
      },
      {
        mount: '/x',
        label: null,
        fs: null,
        totalMb: 0,
        usedMb: 0,
        usedPercent: 0,
      },
    ])
  })

  it('returns an empty list for a non-array value', () => {
    expect(parseSdInventoryDisks({ mount: '/' })).toEqual([])
    expect(parseSdInventoryDisks(null)).toEqual([])
  })
})

describe('toSdInventoryDeviceDTO', () => {
  it('maps a fresh device with usage percentages', () => {
    const dto = toSdInventoryDeviceDTO(createFakeSdInventoryDevice(), {
      staleAfterDays: 7,
      now: new Date('2026-10-02T00:00:00.000Z'),
    })
    expect(dto).toMatchObject({
      id: 'dev-1',
      hostname: 'PC-RECEPCAO',
      ramUsedPercent: 50,
      stale: false,
      openAlerts: 0,
      lastSeenAt: '2026-10-01T12:00:00.000Z',
    })
    expect(dto.disks[0]?.usedPercent).toBe(50)
  })

  it('marks stale devices and leaves RAM percent null without a total', () => {
    const dto = toSdInventoryDeviceDTO(
      createFakeSdInventoryDevice({ ramTotalMb: null, _count: { alerts: 2 } }),
      { staleAfterDays: 7, now: NOW },
    )
    expect(dto.stale).toBe(true)
    expect(dto.ramUsedPercent).toBeNull()
    expect(dto.openAlerts).toBe(2)
  })

  it('leaves RAM percent null when usage is unknown', () => {
    const dto = toSdInventoryDeviceDTO(
      createFakeSdInventoryDevice({ ramUsedMb: null }),
      {
        staleAfterDays: 7,
        now: NOW,
      },
    )
    expect(dto.ramUsedPercent).toBeNull()
  })
})

describe('toSdInventoryDeviceDetailDTO', () => {
  it('adds software, alerts and the CMDB item name', () => {
    const dto = toSdInventoryDeviceDetailDTO(
      createFakeSdInventoryDeviceDetail(),
      {
        staleAfterDays: 7,
        now: NOW,
      },
    )
    expect(dto.configItemName).toBe('PC-RECEPCAO')
    expect(dto.software).toEqual([
      { id: 'sw-1', name: 'Firefox', version: '130.0', publisher: 'Mozilla' },
    ])
    expect(dto.alerts[0]).toMatchObject({
      hostname: 'PC-RECEPCAO',
      kind: 'DISK',
      resolvedAt: null,
    })
  })

  it('has no CMDB name when the device is not linked', () => {
    const dto = toSdInventoryDeviceDetailDTO(
      createFakeSdInventoryDeviceDetail({
        configItem: null,
        configItemId: null,
      }),
      { staleAfterDays: 7, now: NOW },
    )
    expect(dto.configItemName).toBeNull()
  })

  it('maps resolved alerts with their timestamp', () => {
    const resolvedAt = new Date('2026-10-02T00:00:00.000Z')
    const detail = createFakeSdInventoryDeviceDetail()
    const first = detail.alerts[0]
    if (!first) throw new Error('fixture without alerts')
    const dto = toSdInventoryDeviceDetailDTO(
      { ...detail, alerts: [{ ...first, status: 'RESOLVED', resolvedAt }] },
      { staleAfterDays: 7, now: NOW },
    )
    expect(dto.alerts[0]?.resolvedAt).toBe('2026-10-02T00:00:00.000Z')
  })
})

describe('toSdInventoryAlertDTO', () => {
  it('maps hostname and optional resolution date', () => {
    expect(toSdInventoryAlertDTO(createFakeSdInventoryAlert())).toMatchObject({
      hostname: 'PC-RECEPCAO',
      resolvedAt: null,
    })
    expect(
      toSdInventoryAlertDTO(
        createFakeSdInventoryAlert({
          resolvedAt: new Date('2026-10-02T00:00:00.000Z'),
        }),
      ).resolvedAt,
    ).toBe('2026-10-02T00:00:00.000Z')
  })
})

describe('token and target DTOs', () => {
  it('never exposes the token hash, only the one-time value', () => {
    const token = createFakeSdInventoryToken()
    const dto = toSdInventoryTokenDTO(token)
    expect(dto).not.toHaveProperty('tokenHash')
    expect(dto).toMatchObject({ lastUsedAt: null, revokedAt: null })
    expect(toSdInventoryTokenWithValueDTO(token, 'plain').token).toBe('plain')
    expect(
      toSdInventoryTokenDTO(
        createFakeSdInventoryToken({
          lastUsedAt: new Date('2026-10-02T00:00:00.000Z'),
          revokedAt: new Date('2026-10-03T00:00:00.000Z'),
        }),
      ),
    ).toMatchObject({
      lastUsedAt: '2026-10-02T00:00:00.000Z',
      revokedAt: '2026-10-03T00:00:00.000Z',
    })
  })

  it('never exposes the community, only whether one is stored', () => {
    const dto = toSdInventorySnmpTargetDTO(createFakeSdInventoryTarget())
    expect(dto).not.toHaveProperty('communityEnc')
    expect(dto).not.toHaveProperty('community')
    expect(dto.hasCommunity).toBe(true)
    expect(
      toSdInventorySnmpTargetDTO(
        createFakeSdInventoryTarget({ communityEnc: '' }),
      ).hasCommunity,
    ).toBe(false)
  })

  it('maps scan results when present', () => {
    expect(
      toSdInventorySnmpTargetDTO(
        createFakeSdInventoryTarget({
          lastRunAt: new Date('2026-10-02T00:00:00.000Z'),
          nextRunAt: new Date('2026-10-03T00:00:00.000Z'),
          lastStatus: 'PARTIAL',
          lastFound: 4,
          lastError: '1 endereço(s) com falha',
        }),
      ),
    ).toMatchObject({
      lastRunAt: '2026-10-02T00:00:00.000Z',
      nextRunAt: '2026-10-03T00:00:00.000Z',
      lastStatus: 'PARTIAL',
      lastFound: 4,
    })
  })

  it('copies software catalog rows', () => {
    const row = {
      name: 'Firefox',
      version: '130',
      publisher: null,
      deviceCount: 3,
    }
    expect(toSdInventorySoftwareCatalogRowDTO(row)).toEqual(row)
  })
})

describe('merge and discovery mapping', () => {
  it('maps the merged sources and primary hostname on the detail', () => {
    const dto = toSdInventoryDeviceDetailDTO(
      createFakeSdInventoryDeviceDetail({
        mergedInto: { hostname: 'PC-PRINCIPAL' },
        mergedFrom: [{ id: 'dev-2', hostname: 'pc-01', source: 'SNMP' }],
      }),
      { staleAfterDays: 7, now: NOW },
    )
    expect(dto.mergedIntoHostname).toBe('PC-PRINCIPAL')
    expect(dto.mergedSources).toEqual([
      { id: 'dev-2', hostname: 'pc-01', source: 'SNMP' },
    ])
    expect(dto).toMatchObject({
      managed: true,
      mergedIntoId: null,
      mergeLocked: false,
    })
  })

  it('maps a discovery range, with and without a previous run', () => {
    expect(
      toSdInventoryDiscoveryRangeDTO(createFakeSdInventoryDiscoveryRange()),
    ).toMatchObject({
      cidr: '10.0.1.0/24',
      enabled: true,
      lastRunAt: null,
      nextRunAt: null,
      lastStatus: null,
    })
    expect(
      toSdInventoryDiscoveryRangeDTO(
        createFakeSdInventoryDiscoveryRange({
          lastRunAt: new Date('2026-10-02T00:00:00.000Z'),
          nextRunAt: new Date('2026-10-03T00:00:00.000Z'),
          lastStatus: 'SUCCESS',
          lastProbed: 254,
          lastFound: 12,
        }),
      ),
    ).toMatchObject({
      lastRunAt: '2026-10-02T00:00:00.000Z',
      nextRunAt: '2026-10-03T00:00:00.000Z',
      lastProbed: 254,
      lastFound: 12,
    })
  })

  it('maps an agent release without exposing the storage key', () => {
    const dto = toSdInventoryAgentReleaseDTO(
      createFakeSdInventoryAgentRelease(),
    )
    expect(dto).not.toHaveProperty('storageKey')
    expect(dto).toMatchObject({
      version: '2026.11.01',
      os: 'linux',
      publishedAt: '2026-10-01T12:00:00.000Z',
    })
  })

  it('never exposes SNMPv3 keys, only whether they exist', () => {
    const dto = toSdInventorySnmpTargetDTO(
      createFakeSdInventoryTarget({
        snmpVersion: 'V3',
        communityEnc: '',
        v3Username: 'monitor',
        v3AuthProtocol: 'SHA256',
        v3AuthKeyEnc: 'enc(a)',
        v3PrivProtocol: 'AES',
        v3PrivKeyEnc: null,
      }),
    )
    expect(dto).not.toHaveProperty('v3AuthKeyEnc')
    expect(dto).not.toHaveProperty('v3PrivKeyEnc')
    expect(dto).toMatchObject({
      snmpVersion: 'V3',
      hasCommunity: false,
      v3Username: 'monitor',
      hasV3AuthKey: true,
      hasV3PrivKey: false,
    })
  })
})
