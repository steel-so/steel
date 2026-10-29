import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeSdInventoryAlert,
  createFakeSdInventoryDevice,
  createFakeSdInventoryDeviceDetail,
} from '@/src/__tests__/factories/nov-s1-asset-inventory.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { actAs } from '@/src/__tests__/helpers/sd-config.helpers'
import { databaseError, sdInventoryDeviceNotFound } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/sd-access.repository')
vi.mock('@/src/repositories/sd-inventory-alert.repository')
vi.mock('@/src/repositories/sd-inventory-device.repository')
vi.mock('@/src/repositories/sd-inventory-settings.repository')

import { SdInventoryAlertRepository } from '@/src/repositories/sd-inventory-alert.repository'
import { SdInventoryDeviceRepository } from '@/src/repositories/sd-inventory-device.repository'
import { SdInventorySettingsRepository } from '@/src/repositories/sd-inventory-settings.repository'
import { SdInventoryService } from '../sd-inventory.service'

const devices = vi.mocked(SdInventoryDeviceRepository)
const alerts = vi.mocked(SdInventoryAlertRepository)
const settings = vi.mocked(SdInventorySettingsRepository)
const WS = 'ws1'
const NOW = new Date('2026-10-20T12:00:00.000Z')
const query = { page: 1, pageSize: 25 }

beforeEach(() => {
  actAs('agent')
  settings.find.mockResolvedValue(ok(null))
  devices.list.mockResolvedValue(
    ok({ items: [createFakeSdInventoryDevice()], total: 1 }),
  )
  devices.findById.mockResolvedValue(ok(createFakeSdInventoryDeviceDetail()))
  devices.summary.mockResolvedValue(
    ok({ total: 1, agents: 1, snmp: 0, stale: 0, openAlerts: 0 }),
  )
  devices.listSoftware.mockResolvedValue(
    ok({
      items: [
        { name: 'Firefox', version: '130', publisher: null, deviceCount: 2 },
      ],
      total: 1,
    }),
  )
  alerts.list.mockResolvedValue(ok([createFakeSdInventoryAlert()]))
})

describe('authorization', () => {
  it.each(['requester', 'stranger', 'disabled'] as const)(
    'refuses %s everywhere',
    async (actor) => {
      actAs(actor)
      expectErr(await SdInventoryService.summary('u1', WS))
      expectErr(await SdInventoryService.listDevices('u1', WS, query))
      expectErr(await SdInventoryService.getDevice('u1', WS, 'dev-1'))
      expectErr(await SdInventoryService.listAlerts('u1', WS, { limit: 50 }))
      expectErr(await SdInventoryService.listSoftware('u1', WS, query))
      expect(devices.list).not.toHaveBeenCalled()
      expect(alerts.list).not.toHaveBeenCalled()
    },
  )
})

describe('summary', () => {
  it('passes the stale cutoff computed from the workspace setting', async () => {
    expectOk(await SdInventoryService.summary('u1', WS, NOW))
    expect(devices.summary).toHaveBeenCalledWith(
      WS,
      new Date('2026-10-13T12:00:00.000Z'),
    )
  })

  it('propagates settings and repository errors', async () => {
    settings.find.mockResolvedValue(err(databaseError()))
    expectErr(await SdInventoryService.summary('u1', WS, NOW), 'DATABASE_ERROR')
    settings.find.mockResolvedValue(ok(null))
    devices.summary.mockResolvedValue(err(databaseError()))
    expectErr(await SdInventoryService.summary('u1', WS, NOW), 'DATABASE_ERROR')
  })
})

describe('listDevices', () => {
  it('returns a page of DTOs with the stale flag', async () => {
    const page = expectOk(
      await SdInventoryService.listDevices('u1', WS, query, NOW),
    )
    expect(page).toMatchObject({ total: 1, page: 1, pageSize: 25 })
    expect(page.items[0]).toMatchObject({
      hostname: 'PC-RECEPCAO',
      stale: true,
    })
    expect(devices.list).toHaveBeenCalledWith(
      WS,
      query,
      new Date('2026-10-13T12:00:00.000Z'),
    )
  })

  it('propagates errors', async () => {
    devices.list.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdInventoryService.listDevices('u1', WS, query, NOW),
      'DATABASE_ERROR',
    )
    settings.find.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdInventoryService.listDevices('u1', WS, query, NOW),
      'DATABASE_ERROR',
    )
  })
})

describe('getDevice', () => {
  it('returns the detail with software and alerts', async () => {
    const dto = expectOk(
      await SdInventoryService.getDevice('u1', WS, 'dev-1', NOW),
    )
    expect(dto.software).toHaveLength(1)
    expect(dto.alerts).toHaveLength(1)
    expect(devices.findById).toHaveBeenCalledWith('dev-1', WS)
  })

  it('does not find a device of another workspace', async () => {
    devices.findById.mockResolvedValue(err(sdInventoryDeviceNotFound()))
    expectErr(
      await SdInventoryService.getDevice('u1', WS, 'dev-x'),
      'SD_INVENTORY_DEVICE_NOT_FOUND',
    )
  })

  it('propagates settings errors', async () => {
    settings.find.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdInventoryService.getDevice('u1', WS, 'dev-1'),
      'DATABASE_ERROR',
    )
  })
})

describe('listAlerts and listSoftware', () => {
  it('lists alerts with the filters', async () => {
    const list = expectOk(
      await SdInventoryService.listAlerts('u1', WS, {
        status: 'OPEN',
        limit: 10,
      }),
    )
    expect(list[0]).toMatchObject({ hostname: 'PC-RECEPCAO', kind: 'DISK' })
    expect(alerts.list).toHaveBeenCalledWith(WS, { status: 'OPEN', limit: 10 })
    alerts.list.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdInventoryService.listAlerts('u1', WS, { limit: 10 }),
      'DATABASE_ERROR',
    )
  })

  it('lists the software catalog as a page', async () => {
    const page = expectOk(
      await SdInventoryService.listSoftware('u1', WS, {
        ...query,
        search: 'fire',
      }),
    )
    expect(page.items[0]).toMatchObject({ name: 'Firefox', deviceCount: 2 })
    expect(page).toMatchObject({ total: 1, page: 1, pageSize: 25 })
    devices.listSoftware.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdInventoryService.listSoftware('u1', WS, query),
      'DATABASE_ERROR',
    )
  })
})
