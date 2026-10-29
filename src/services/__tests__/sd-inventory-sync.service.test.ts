import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeSdInventoryDevice,
  createFakeSdInventorySettings,
} from '@/src/__tests__/factories/nov-s1-asset-inventory.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import {
  databaseError,
  sdConfigItemNotFound,
  sdConfigItemTypeNotFound,
} from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/repositories/sd-config-item.repository')
vi.mock('@/src/repositories/sd-config-item-type.repository')
vi.mock('@/src/repositories/sd-inventory-alert.repository')
vi.mock('@/src/repositories/sd-inventory-device.repository')
vi.mock('@/src/repositories/sd-inventory-settings.repository')

import { logger } from '@/lib/axiom/logger'
import { indexSearchDocument } from '@/src/lib/search/index-hooks'
import { SdConfigItemRepository } from '@/src/repositories/sd-config-item.repository'
import { SdConfigItemTypeRepository } from '@/src/repositories/sd-config-item-type.repository'
import { SdInventoryAlertRepository } from '@/src/repositories/sd-inventory-alert.repository'
import { SdInventoryDeviceRepository } from '@/src/repositories/sd-inventory-device.repository'
import { SdInventorySettingsRepository } from '@/src/repositories/sd-inventory-settings.repository'
import {
  SD_INVENTORY_DEFAULT_TYPE_NAMES,
  type SdInventoryDeviceInput,
  syncInventoryDevice,
} from '../sd-inventory-sync.service'

const devices = vi.mocked(SdInventoryDeviceRepository)
const alerts = vi.mocked(SdInventoryAlertRepository)
const items = vi.mocked(SdConfigItemRepository)
const types = vi.mocked(SdConfigItemTypeRepository)
const settings = vi.mocked(SdInventorySettingsRepository)

const WS = 'ws1'
const NOW = new Date('2026-10-20T12:00:00.000Z')

function input(
  overrides?: Partial<SdInventoryDeviceInput>,
): SdInventoryDeviceInput {
  return {
    source: 'AGENT',
    externalKey: 'agent:abcdefgh',
    hostname: 'PC-RECEPCAO',
    osName: 'Windows 11',
    osVersion: '10.0',
    arch: 'amd64',
    manufacturer: 'Dell',
    model: 'OptiPlex',
    serialNumber: 'SN-1',
    cpuModel: null,
    cpuCores: null,
    ramTotalMb: 1000,
    ramUsedMb: 950,
    ipAddresses: ['10.0.0.20', '10.0.0.21'],
    macAddresses: [],
    disks: [{ mount: 'C:', label: null, fs: null, totalMb: 1000, usedMb: 500 }],
    agentVersion: '1.0.0',
    software: [{ name: 'Firefox', version: '130', publisher: null }],
    tokenId: 'tok-1',
    snmpTargetId: null,
    customerId: null,
    ...overrides,
  }
}

beforeEach(() => {
  settings.find.mockResolvedValue(ok(null))
  devices.findByKey.mockResolvedValue(ok(null))
  devices.upsert.mockResolvedValue(
    ok(createFakeSdInventoryDevice({ configItemId: null })),
  )
  devices.linkConfigItem.mockResolvedValue(ok(undefined))
  devices.replaceSoftware.mockResolvedValue(ok(1))
  devices.findAdoptableConfigItem.mockResolvedValue(ok(null))
  devices.ensureConfigItemType.mockResolvedValue(ok({ id: 'type-default' }))
  items.findById.mockResolvedValue(ok({ id: 'ci-1' } as never))
  items.update.mockResolvedValue(ok({ id: 'ci-1' } as never))
  items.create.mockResolvedValue(ok({ id: 'ci-new' } as never))
  types.findById.mockResolvedValue(ok({ id: 'type-custom' } as never))
  alerts.apply.mockResolvedValue(ok({ opened: 0, resolved: 0 }))
})

describe('syncInventoryDevice: new device', () => {
  it('creates the device, a CMDB item in the default type, software and alerts', async () => {
    alerts.apply.mockResolvedValue(ok({ opened: 1, resolved: 0 }))
    const result = expectOk(await syncInventoryDevice(WS, 'u1', input(), NOW))

    expect(result).toMatchObject({
      created: true,
      configItemId: 'ci-new',
      openedAlerts: 1,
      resolvedAlerts: 0,
    })
    expect(devices.ensureConfigItemType).toHaveBeenCalledWith(
      WS,
      SD_INVENTORY_DEFAULT_TYPE_NAMES.AGENT,
    )
    expect(items.create).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WS,
        createdById: 'u1',
        name: 'PC-RECEPCAO',
        typeId: 'type-default',
        serialNumber: 'SN-1',
        manufacturer: 'Dell',
        model: 'OptiPlex',
        ipAddress: '10.0.0.20',
      }),
    )
    expect(devices.linkConfigItem).toHaveBeenCalledWith('dev-1', 'ci-new')
    expect(indexSearchDocument).toHaveBeenCalledWith(
      'sd-config-item',
      WS,
      'ci-new',
    )
    expect(devices.replaceSoftware).toHaveBeenCalledWith('dev-1', [
      { name: 'Firefox', version: '130', publisher: null },
    ])
    expect(logger.warn).toHaveBeenCalledWith(
      'servicedesk.inventory.alert_opened',
      expect.objectContaining({ opened: 1 }),
    )
  })

  it('stores the device with the disks as plain JSON and the last-seen time', async () => {
    expectOk(await syncInventoryDevice(WS, 'u1', input(), NOW))
    expect(devices.upsert).toHaveBeenCalledWith(
      WS,
      'agent:abcdefgh',
      expect.objectContaining({
        source: 'AGENT',
        lastSeenAt: NOW,
        tokenId: 'tok-1',
        disks: [
          { mount: 'C:', label: null, fs: null, totalMb: 1000, usedMb: 500 },
        ],
      }),
    )
  })

  it('evaluates alerts with the workspace thresholds', async () => {
    settings.find.mockResolvedValue(
      ok(
        createFakeSdInventorySettings({
          diskThresholdPercent: 50,
          ramThresholdPercent: 99,
        }),
      ),
    )
    expectOk(await syncInventoryDevice(WS, 'u1', input(), NOW))
    expect(alerts.apply).toHaveBeenCalledWith(WS, 'dev-1', [
      {
        kind: 'DISK',
        mount: 'C:',
        usedPercent: 50,
        threshold: 50,
        breached: true,
      },
      {
        kind: 'RAM',
        mount: '',
        usedPercent: 95,
        threshold: 99,
        breached: false,
      },
    ])
  })

  it('uses the network type for SNMP devices and carries the target customer', async () => {
    expectOk(
      await syncInventoryDevice(
        WS,
        'u1',
        input({
          source: 'SNMP',
          customerId: 'cus-1',
          software: null,
          snmpTargetId: 'tgt-1',
        }),
        NOW,
      ),
    )
    expect(devices.ensureConfigItemType).toHaveBeenCalledWith(
      WS,
      SD_INVENTORY_DEFAULT_TYPE_NAMES.SNMP,
    )
    expect(items.create).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'cus-1',
        notes: expect.stringContaining('SNMP'),
      }),
    )
    expect(devices.replaceSoftware).not.toHaveBeenCalled()
  })

  it('uses the configured default type when it still exists', async () => {
    settings.find.mockResolvedValue(
      ok(createFakeSdInventorySettings({ defaultTypeId: 'type-custom' })),
    )
    expectOk(await syncInventoryDevice(WS, 'u1', input(), NOW))
    expect(items.create).toHaveBeenCalledWith(
      expect.objectContaining({ typeId: 'type-custom' }),
    )
    expect(devices.ensureConfigItemType).not.toHaveBeenCalled()
  })

  it('falls back to the default name when the configured type was deleted', async () => {
    settings.find.mockResolvedValue(
      ok(createFakeSdInventorySettings({ defaultTypeId: 'gone' })),
    )
    types.findById.mockResolvedValue(err(sdConfigItemTypeNotFound()))
    expectOk(await syncInventoryDevice(WS, 'u1', input(), NOW))
    expect(items.create).toHaveBeenCalledWith(
      expect.objectContaining({ typeId: 'type-default' }),
    )
  })

  it('does not warn when no alert was opened', async () => {
    expectOk(await syncInventoryDevice(WS, 'u1', input(), NOW))
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('works without the optional hardware facts', async () => {
    expectOk(
      await syncInventoryDevice(
        WS,
        'u1',
        input({
          serialNumber: null,
          ipAddresses: [],
          manufacturer: null,
          model: null,
        }),
        NOW,
      ),
    )
    expect(devices.findAdoptableConfigItem).not.toHaveBeenCalled()
    expect(items.create).toHaveBeenCalledWith(
      expect.objectContaining({ serialNumber: null, ipAddress: null }),
    )
  })
})

describe('syncInventoryDevice: CMDB item resolution', () => {
  it('adopts a manually created item with the same serial number', async () => {
    devices.findAdoptableConfigItem.mockResolvedValue(ok({ id: 'ci-manual' }))
    const result = expectOk(await syncInventoryDevice(WS, 'u1', input(), NOW))
    expect(result.configItemId).toBe('ci-manual')
    expect(devices.linkConfigItem).toHaveBeenCalledWith('dev-1', 'ci-manual')
    expect(items.update).toHaveBeenCalledWith(
      'ci-manual',
      expect.objectContaining({ serialNumber: 'SN-1', ipAddress: '10.0.0.20' }),
    )
    expect(items.create).not.toHaveBeenCalled()
  })

  it('updates only the facts the inventory knows on an already linked item', async () => {
    devices.upsert.mockResolvedValue(
      ok(createFakeSdInventoryDevice({ configItemId: 'ci-1' })),
    )
    const result = expectOk(
      await syncInventoryDevice(
        WS,
        'u1',
        input({ manufacturer: null, model: null }),
        NOW,
      ),
    )
    expect(result).toMatchObject({ created: true, configItemId: 'ci-1' })
    expect(items.update).toHaveBeenCalledWith('ci-1', {
      serialNumber: 'SN-1',
      ipAddress: '10.0.0.20',
    })
    expect(items.create).not.toHaveBeenCalled()
  })

  it('leaves the item alone when there is nothing to update', async () => {
    devices.upsert.mockResolvedValue(
      ok(createFakeSdInventoryDevice({ configItemId: 'ci-1' })),
    )
    devices.findByKey.mockResolvedValue(ok(createFakeSdInventoryDevice()))
    const result = expectOk(
      await syncInventoryDevice(
        WS,
        'u1',
        input({
          serialNumber: null,
          manufacturer: null,
          model: null,
          ipAddresses: [],
        }),
        NOW,
      ),
    )
    expect(result.created).toBe(false)
    expect(items.update).not.toHaveBeenCalled()
  })

  it('leaves an adopted item alone when there is nothing to update', async () => {
    devices.findAdoptableConfigItem.mockResolvedValue(ok({ id: 'ci-manual' }))
    expectOk(
      await syncInventoryDevice(
        WS,
        'u1',
        input({ manufacturer: null, model: null, ipAddresses: [] }),
        NOW,
      ),
    )
    expect(items.update).toHaveBeenCalledWith('ci-manual', {
      serialNumber: 'SN-1',
    })
  })

  it('recreates the item when the linked one was deleted in the CMDB', async () => {
    devices.upsert.mockResolvedValue(
      ok(createFakeSdInventoryDevice({ configItemId: 'ci-gone' })),
    )
    items.findById.mockResolvedValue(err(sdConfigItemNotFound()))
    const result = expectOk(await syncInventoryDevice(WS, 'u1', input(), NOW))
    expect(result.configItemId).toBe('ci-new')
    expect(devices.linkConfigItem).toHaveBeenCalledWith('dev-1', 'ci-new')
  })

  it('skips the CMDB when syncing items is switched off', async () => {
    settings.find.mockResolvedValue(
      ok(createFakeSdInventorySettings({ syncConfigItems: false })),
    )
    devices.upsert.mockResolvedValue(
      ok(createFakeSdInventoryDevice({ configItemId: null })),
    )
    const result = expectOk(await syncInventoryDevice(WS, 'u1', input(), NOW))
    expect(result.configItemId).toBeNull()
    expect(items.create).not.toHaveBeenCalled()
    expect(items.findById).not.toHaveBeenCalled()
    expect(alerts.apply).toHaveBeenCalled()
  })
})

describe('syncInventoryDevice: error propagation', () => {
  const fail = () => err(databaseError())

  it.each([
    ['settings', () => settings.find.mockResolvedValue(fail())],
    ['device lookup', () => devices.findByKey.mockResolvedValue(fail())],
    ['device upsert', () => devices.upsert.mockResolvedValue(fail())],
    [
      'adoption lookup',
      () => devices.findAdoptableConfigItem.mockResolvedValue(fail()),
    ],
    [
      'type creation',
      () => devices.ensureConfigItemType.mockResolvedValue(fail()),
    ],
    ['item creation', () => items.create.mockResolvedValue(fail())],
    ['item link', () => devices.linkConfigItem.mockResolvedValue(fail())],
    [
      'software replacement',
      () => devices.replaceSoftware.mockResolvedValue(fail()),
    ],
    ['alert reconciliation', () => alerts.apply.mockResolvedValue(fail())],
  ])('propagates a %s failure', async (_label, arrange) => {
    arrange()
    expectErr(
      await syncInventoryDevice(WS, 'u1', input(), NOW),
      'DATABASE_ERROR',
    )
  })

  it('propagates item update failures on a linked item', async () => {
    devices.upsert.mockResolvedValue(
      ok(createFakeSdInventoryDevice({ configItemId: 'ci-1' })),
    )
    items.update.mockResolvedValue(fail())
    expectErr(
      await syncInventoryDevice(WS, 'u1', input(), NOW),
      'DATABASE_ERROR',
    )
  })

  it('propagates adoption link and update failures', async () => {
    devices.findAdoptableConfigItem.mockResolvedValue(ok({ id: 'ci-manual' }))
    devices.linkConfigItem.mockResolvedValue(fail())
    expectErr(
      await syncInventoryDevice(WS, 'u1', input(), NOW),
      'DATABASE_ERROR',
    )

    devices.linkConfigItem.mockResolvedValue(ok(undefined))
    items.update.mockResolvedValue(fail())
    expectErr(
      await syncInventoryDevice(WS, 'u1', input(), NOW),
      'DATABASE_ERROR',
    )
  })

  it('uses the real clock when no time is given', async () => {
    expectOk(await syncInventoryDevice(WS, 'u1', input()))
    const written = devices.upsert.mock.calls[0]?.[2]
    expect(written?.lastSeenAt).toBeInstanceOf(Date)
  })
})
