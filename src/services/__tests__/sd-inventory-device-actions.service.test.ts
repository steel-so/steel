import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSdInventoryDevice } from '@/src/__tests__/factories/nov-s1-asset-inventory.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { actAs } from '@/src/__tests__/helpers/sd-config.helpers'
import { databaseError, sdInventoryDeviceNotFound } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/sd-access.repository')
vi.mock('@/src/repositories/sd-inventory-device.repository')
vi.mock('../sd-inventory-sync.service')

import { auditMutation } from '@/lib/axiom/audit'
import { SdInventoryDeviceRepository } from '@/src/repositories/sd-inventory-device.repository'
import { SdInventoryDeviceActionsService } from '../sd-inventory-device-actions.service'
import { ensureConfigItemForDevice } from '../sd-inventory-sync.service'

const devices = vi.mocked(SdInventoryDeviceRepository)
const ensureItem = vi.mocked(ensureConfigItemForDevice)
const WS = 'ws1'

const discovered = () =>
  createFakeSdInventoryDevice({
    id: 'dev-d',
    source: 'DISCOVERY',
    managed: false,
    configItemId: null,
  })

beforeEach(() => {
  actAs('owner')
  devices.findRowById.mockImplementation(async (id) =>
    ok(createFakeSdInventoryDevice({ id })),
  )
  devices.mergeInto.mockResolvedValue(
    ok({ movedConfigItemId: null, orphanedConfigItemId: null }),
  )
  devices.unmerge.mockResolvedValue(ok(createFakeSdInventoryDevice()))
  devices.markManaged.mockResolvedValue(ok(createFakeSdInventoryDevice()))
  devices.markIgnored.mockResolvedValue(ok(undefined))
  ensureItem.mockResolvedValue(ok('ci-1'))
})

describe('authorization', () => {
  it.each([
    ['agent'],
    ['requester'],
    ['viewer'],
    ['stranger'],
    ['disabled'],
  ] as const)('refuses every action for %s', async (actor) => {
    actAs(actor)
    const results = await Promise.all([
      SdInventoryDeviceActionsService.merge('u1', WS, 'a', 'b'),
      SdInventoryDeviceActionsService.unmerge('u1', WS, 'a'),
      SdInventoryDeviceActionsService.adopt('u1', WS, 'a'),
      SdInventoryDeviceActionsService.dismiss('u1', WS, 'a'),
    ])
    for (const result of results) expect(result.ok).toBe(false)
    expect(devices.mergeInto).not.toHaveBeenCalled()
    expect(devices.markManaged).not.toHaveBeenCalled()
    expect(devices.markIgnored).not.toHaveBeenCalled()
  })
})

describe('merge', () => {
  it('makes the device a secondary of the target and audits it', async () => {
    expectOk(await SdInventoryDeviceActionsService.merge('u1', WS, 'a', 'b'))
    expect(devices.mergeInto).toHaveBeenCalledWith(WS, 'a', 'b', {
      lock: false,
    })
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'sd_inventory_device',
        targetId: 'a',
        meta: expect.objectContaining({ merge: 'manual', intoId: 'b' }),
      }),
    )
  })

  it('refuses merging a device into itself', async () => {
    expectErr(
      await SdInventoryDeviceActionsService.merge('u1', WS, 'a', 'a'),
      'SD_INVENTORY_DEVICE_STATE_INVALID',
    )
  })

  it('refuses a target that is already a secondary', async () => {
    devices.findRowById.mockImplementation(async (id) =>
      ok(
        createFakeSdInventoryDevice({
          id,
          mergedIntoId: id === 'b' ? 'main' : null,
        }),
      ),
    )
    expectErr(
      await SdInventoryDeviceActionsService.merge('u1', WS, 'a', 'b'),
      'SD_INVENTORY_DEVICE_STATE_INVALID',
    )
  })

  it('does not reach devices of another workspace', async () => {
    devices.findRowById.mockResolvedValue(err(sdInventoryDeviceNotFound()))
    expectErr(
      await SdInventoryDeviceActionsService.merge('u1', WS, 'x', 'b'),
      'SD_INVENTORY_DEVICE_NOT_FOUND',
    )
    expect(devices.mergeInto).not.toHaveBeenCalled()
  })

  it('reports a missing target and database failures', async () => {
    devices.findRowById
      .mockResolvedValueOnce(ok(createFakeSdInventoryDevice({ id: 'a' })))
      .mockResolvedValueOnce(err(sdInventoryDeviceNotFound()))
    expectErr(
      await SdInventoryDeviceActionsService.merge('u1', WS, 'a', 'x'),
      'SD_INVENTORY_DEVICE_NOT_FOUND',
    )
    devices.mergeInto.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdInventoryDeviceActionsService.merge('u1', WS, 'a', 'b'),
      'DATABASE_ERROR',
    )
  })
})

describe('unmerge', () => {
  const merged = () =>
    createFakeSdInventoryDevice({ id: 'a', mergedIntoId: 'main' })

  it('frees the device, locks auto merge and recreates its CMDB item', async () => {
    devices.findRowById.mockResolvedValue(ok(merged()))
    expectOk(await SdInventoryDeviceActionsService.unmerge('u1', WS, 'a'))
    expect(devices.unmerge).toHaveBeenCalledWith(WS, 'a')
    expect(ensureItem).toHaveBeenCalledTimes(1)
  })

  it('does not create a CMDB item for an unmanaged device', async () => {
    devices.findRowById.mockResolvedValue(ok(merged()))
    devices.unmerge.mockResolvedValue(
      ok(createFakeSdInventoryDevice({ managed: false })),
    )
    expectOk(await SdInventoryDeviceActionsService.unmerge('u1', WS, 'a'))
    expect(ensureItem).not.toHaveBeenCalled()
  })

  it('refuses a device that is not merged', async () => {
    expectErr(
      await SdInventoryDeviceActionsService.unmerge('u1', WS, 'a'),
      'SD_INVENTORY_DEVICE_STATE_INVALID',
    )
    expect(devices.unmerge).not.toHaveBeenCalled()
  })

  it('propagates lookup, unmerge and CMDB failures', async () => {
    devices.findRowById.mockResolvedValueOnce(err(sdInventoryDeviceNotFound()))
    expectErr(
      await SdInventoryDeviceActionsService.unmerge('u1', WS, 'a'),
      'SD_INVENTORY_DEVICE_NOT_FOUND',
    )
    devices.findRowById.mockResolvedValue(ok(merged()))
    devices.unmerge.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SdInventoryDeviceActionsService.unmerge('u1', WS, 'a'),
      'DATABASE_ERROR',
    )
    ensureItem.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdInventoryDeviceActionsService.unmerge('u1', WS, 'a'),
      'DATABASE_ERROR',
    )
  })
})

describe('adopt', () => {
  it('turns a discovered device into a managed one with a CMDB item', async () => {
    devices.findRowById.mockResolvedValue(ok(discovered()))
    const result = expectOk(
      await SdInventoryDeviceActionsService.adopt('u1', WS, 'dev-d'),
    )
    expect(result).toEqual({ deviceId: 'dev-d', configItemId: 'ci-1' })
    expect(devices.markManaged).toHaveBeenCalledWith('dev-d')
  })

  it('refuses devices that are already managed or merged', async () => {
    expectErr(
      await SdInventoryDeviceActionsService.adopt('u1', WS, 'dev-1'),
      'SD_INVENTORY_DEVICE_STATE_INVALID',
    )
    devices.findRowById.mockResolvedValue(
      ok({ ...discovered(), mergedIntoId: 'main' }),
    )
    expectErr(
      await SdInventoryDeviceActionsService.adopt('u1', WS, 'dev-d'),
      'SD_INVENTORY_DEVICE_STATE_INVALID',
    )
    expect(devices.markManaged).not.toHaveBeenCalled()
  })

  it('propagates failures at each step', async () => {
    devices.findRowById.mockResolvedValueOnce(err(sdInventoryDeviceNotFound()))
    expectErr(
      await SdInventoryDeviceActionsService.adopt('u1', WS, 'x'),
      'SD_INVENTORY_DEVICE_NOT_FOUND',
    )
    devices.findRowById.mockResolvedValue(ok(discovered()))
    devices.markManaged.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SdInventoryDeviceActionsService.adopt('u1', WS, 'dev-d'),
      'DATABASE_ERROR',
    )
    ensureItem.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdInventoryDeviceActionsService.adopt('u1', WS, 'dev-d'),
      'DATABASE_ERROR',
    )
  })
})

describe('dismiss', () => {
  it('hides a discovered device for good', async () => {
    devices.findRowById.mockResolvedValue(ok(discovered()))
    expectOk(await SdInventoryDeviceActionsService.dismiss('u1', WS, 'dev-d'))
    expect(devices.markIgnored).toHaveBeenCalledWith('dev-d', WS)
  })

  it('refuses managed devices and propagates failures', async () => {
    expectErr(
      await SdInventoryDeviceActionsService.dismiss('u1', WS, 'dev-1'),
      'SD_INVENTORY_DEVICE_STATE_INVALID',
    )
    devices.findRowById.mockResolvedValueOnce(err(sdInventoryDeviceNotFound()))
    expectErr(
      await SdInventoryDeviceActionsService.dismiss('u1', WS, 'x'),
      'SD_INVENTORY_DEVICE_NOT_FOUND',
    )
    devices.findRowById.mockResolvedValue(ok(discovered()))
    devices.markIgnored.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdInventoryDeviceActionsService.dismiss('u1', WS, 'dev-d'),
      'DATABASE_ERROR',
    )
  })
})
