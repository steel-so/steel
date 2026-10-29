import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSdInventorySettings } from '@/src/__tests__/factories/nov-s1-asset-inventory.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { actAs } from '@/src/__tests__/helpers/sd-config.helpers'
import { databaseError, sdConfigItemTypeNotFound } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/sd-access.repository')
vi.mock('@/src/repositories/sd-config-item-type.repository')
vi.mock('@/src/repositories/sd-inventory-settings.repository')

import { SdConfigItemTypeRepository } from '@/src/repositories/sd-config-item-type.repository'
import { SdInventorySettingsRepository } from '@/src/repositories/sd-inventory-settings.repository'
import { SdInventorySettingsService } from '../sd-inventory-settings.service'

const settings = vi.mocked(SdInventorySettingsRepository)
const types = vi.mocked(SdConfigItemTypeRepository)
const WS = 'ws1'

beforeEach(() => {
  actAs('owner')
  settings.find.mockResolvedValue(ok(null))
  settings.upsert.mockResolvedValue(
    ok(createFakeSdInventorySettings({ diskThresholdPercent: 80 })),
  )
  types.findById.mockResolvedValue(ok({ id: 't1' } as never))
})

describe('SdInventorySettingsService.load', () => {
  it('returns the defaults when nothing was saved', async () => {
    const dto = expectOk(await SdInventorySettingsService.load(WS))
    expect(dto).toMatchObject({
      diskThresholdPercent: 90,
      staleAfterDays: 7,
      syncConfigItems: true,
    })
  })

  it('returns the saved values', async () => {
    settings.find.mockResolvedValue(
      ok(createFakeSdInventorySettings({ ramThresholdPercent: 70 })),
    )
    expect(
      expectOk(await SdInventorySettingsService.load(WS)).ramThresholdPercent,
    ).toBe(70)
  })

  it('propagates database errors', async () => {
    settings.find.mockResolvedValue(err(databaseError()))
    expectErr(await SdInventorySettingsService.load(WS), 'DATABASE_ERROR')
  })
})

describe('SdInventorySettingsService.get', () => {
  it('lets agents read', async () => {
    actAs('agent')
    expectOk(await SdInventorySettingsService.get('u1', WS))
  })

  it.each(['requester', 'stranger', 'disabled'] as const)(
    'refuses %s',
    async (actor) => {
      actAs(actor)
      expectErr(await SdInventorySettingsService.get('u1', WS))
    },
  )
})

describe('SdInventorySettingsService.update', () => {
  it('saves for admins', async () => {
    const dto = expectOk(
      await SdInventorySettingsService.update('u1', WS, {
        diskThresholdPercent: 80,
      }),
    )
    expect(dto.diskThresholdPercent).toBe(80)
    expect(settings.upsert).toHaveBeenCalledWith(WS, {
      diskThresholdPercent: 80,
    })
  })

  it('checks that the default CMDB type belongs to the workspace', async () => {
    expectOk(
      await SdInventorySettingsService.update('u1', WS, {
        defaultTypeId: 't1',
      }),
    )
    expect(types.findById).toHaveBeenCalledWith('t1', WS)

    types.findById.mockResolvedValue(err(sdConfigItemTypeNotFound()))
    expectErr(
      await SdInventorySettingsService.update('u1', WS, {
        defaultTypeId: 'other',
      }),
      'SD_CONFIG_ITEM_TYPE_NOT_FOUND',
    )
  })

  it('accepts clearing the default type without a lookup', async () => {
    expectOk(
      await SdInventorySettingsService.update('u1', WS, {
        defaultTypeId: null,
      }),
    )
    expect(types.findById).not.toHaveBeenCalled()
  })

  it.each(['agent', 'requester', 'viewer', 'stranger', 'disabled'] as const)(
    'denies %s',
    async (actor) => {
      actAs(actor)
      expectErr(
        await SdInventorySettingsService.update('u1', WS, {
          staleAfterDays: 3,
        }),
      )
      expect(settings.upsert).not.toHaveBeenCalled()
    },
  )

  it('propagates database errors', async () => {
    settings.upsert.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdInventorySettingsService.update('u1', WS, { staleAfterDays: 3 }),
      'DATABASE_ERROR',
    )
  })
})
