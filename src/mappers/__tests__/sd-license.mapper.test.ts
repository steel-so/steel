import { describe, expect, it } from 'vitest'
import {
  createFakeSdInstalledDeviceRow,
  createFakeSdLicenseDetailRow,
  createFakeSdLicenseRow,
  createFakeSdSoftwareLicense,
} from '@/src/__tests__/factories/nov-sd-licenses.factory'
import {
  summarizeSdLicenses,
  toSdConfigItemLicenseDTO,
  toSdLicenseDetailDTO,
  toSdLicenseDTO,
  toSdLicenseInstalledDeviceDTO,
} from '../sd-license.mapper'

const TODAY = '2026-10-30'

describe('toSdLicenseDTO', () => {
  it('maps the row with its compliance', () => {
    const dto = toSdLicenseDTO(
      createFakeSdLicenseRow({
        _count: { assignments: 2 },
        expiresAt: null,
        archivedAt: new Date(),
      }),
      12,
      TODAY,
    )
    expect(dto).toMatchObject({
      id: 'lic-1',
      purchasedAt: '2026-01-10',
      expiresAt: null,
      assetCount: 2,
      installed: 12,
      balance: -2,
      fit: 'UNDER_LICENSED',
      expiryState: 'NONE',
      status: 'UNDER_LICENSED',
      archived: true,
    })
  })

  it('keeps null dates', () => {
    const dto = toSdLicenseDTO(
      createFakeSdLicenseRow({ purchasedAt: null }),
      10,
      TODAY,
    )
    expect(dto.purchasedAt).toBeNull()
    expect(dto.status).toBe('COMPLIANT')
  })
})

describe('toSdLicenseInstalledDeviceDTO', () => {
  it('marks devices whose asset holds the license', () => {
    expect(
      toSdLicenseInstalledDeviceDTO(
        createFakeSdInstalledDeviceRow(),
        new Set(['ci-1']),
      ),
    ).toMatchObject({ assigned: true, softwareVersion: '16.0' })
    expect(
      toSdLicenseInstalledDeviceDTO(createFakeSdInstalledDeviceRow(), new Set())
        .assigned,
    ).toBe(false)
  })

  it('handles a device without an asset or software row', () => {
    const dto = toSdLicenseInstalledDeviceDTO(
      createFakeSdInstalledDeviceRow({
        configItemId: null,
        configItem: null,
        software: [],
      }),
      new Set(['ci-1']),
    )
    expect(dto).toMatchObject({
      assigned: false,
      configItemName: null,
      softwareName: '',
    })
  })
})

describe('toSdLicenseDetailDTO', () => {
  it('adds assets, devices and the unassigned count', () => {
    const row = createFakeSdLicenseDetailRow({
      assignments: [
        {
          id: 'a1',
          licenseId: 'lic-1',
          configItemId: 'ci-1',
          createdAt: new Date(),
          configItem: { id: 'ci-1', name: 'PC-01', code: 'PAT-1' },
        },
      ],
    })
    const dto = toSdLicenseDetailDTO(row, 3, [], 2, TODAY)
    expect(dto.assets).toEqual([
      { configItemId: 'ci-1', name: 'PC-01', code: 'PAT-1' },
    ])
    expect(dto.unassignedCount).toBe(2)
  })
})

describe('toSdConfigItemLicenseDTO', () => {
  it('reports the expiry of an asset license', () => {
    expect(
      toSdConfigItemLicenseDTO(
        createFakeSdSoftwareLicense({
          expiresAt: new Date('2026-11-05T00:00:00Z'),
        }),
        TODAY,
      ),
    ).toMatchObject({ daysLeft: 6, expiryState: 'EXPIRING' })
    expect(
      toSdConfigItemLicenseDTO(
        createFakeSdSoftwareLicense({ expiresAt: null }),
        TODAY,
      ),
    ).toMatchObject({ daysLeft: null, expiryState: 'NONE', expiresAt: null })
  })
})

describe('summarizeSdLicenses', () => {
  it('counts statuses, shortfall, surplus and its cost', () => {
    const make = (
      seats: number,
      installed: number,
      extra: Parameters<typeof createFakeSdLicenseRow>[0] = {},
    ) =>
      toSdLicenseDTO(
        createFakeSdLicenseRow({ seats, expiresAt: null, ...extra }),
        installed,
        TODAY,
      )
    const summary = summarizeSdLicenses([
      make(10, 10),
      make(10, 13),
      make(10, 4, { unitCostCents: 1000 }),
      make(5, 5, { expiresAt: new Date('2026-11-05T00:00:00Z') }),
      make(5, 5, { expiresAt: new Date('2026-10-01T00:00:00Z') }),
      make(8, 6, { unitCostCents: null }),
    ])
    expect(summary).toEqual({
      total: 6,
      compliant: 1,
      underLicensed: 1,
      overLicensed: 2,
      expiring: 1,
      expired: 1,
      shortfallSeats: 3,
      surplusSeats: 8,
      surplusCostCents: 6000,
    })
  })
})
