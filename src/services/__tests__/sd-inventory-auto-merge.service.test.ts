import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSdInventoryDevice } from '@/src/__tests__/factories/nov-s1-asset-inventory.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/repositories/sd-inventory-device.repository')

import { SdInventoryDeviceRepository } from '@/src/repositories/sd-inventory-device.repository'
import {
  autoMergeDevice,
  enrichPrimaryFromSecondary,
} from '../sd-inventory-auto-merge.service'

const devices = vi.mocked(SdInventoryDeviceRepository)

beforeEach(() => {
  devices.findMergeCandidates.mockResolvedValue(ok([]))
})

describe('autoMergeDevice', () => {
  it('does nothing for merged, locked or ignored devices', async () => {
    for (const flags of [
      { mergedIntoId: 'x' },
      { mergeLocked: true },
      { ignored: true },
    ]) {
      const device = createFakeSdInventoryDevice(flags)
      expect(expectOk(await autoMergeDevice('ws1', 'u1', device))).toBe(device)
    }
    expect(devices.findMergeCandidates).not.toHaveBeenCalled()
  })

  it('skips the search when there is nothing to match on', async () => {
    const device = createFakeSdInventoryDevice({
      serialNumber: null,
      macAddresses: [],
      hostname: '10.0.0.5',
    })
    devices.findMergeCandidates.mockResolvedValue(ok([]))
    expect(expectOk(await autoMergeDevice('ws1', 'u1', device))).toBe(device)
    expect(devices.findMergeCandidates).toHaveBeenCalledWith('ws1', {
      id: 'dev-1',
      serialNumber: null,
      macAddresses: [],
      hostnameLabel: null,
    })
  })

  it('propagates a candidate search failure', async () => {
    devices.findMergeCandidates.mockResolvedValue(err(databaseError()))
    expectErr(
      await autoMergeDevice('ws1', 'u1', createFakeSdInventoryDevice()),
      'DATABASE_ERROR',
    )
  })
})

describe('enrichPrimaryFromSecondary', () => {
  it('returns null for a device that is not a secondary', async () => {
    expect(
      expectOk(
        await enrichPrimaryFromSecondary('ws1', createFakeSdInventoryDevice()),
      ),
    ).toBeNull()
    expect(devices.findRowById).not.toHaveBeenCalled()
  })

  it('propagates a primary lookup failure', async () => {
    devices.findRowById.mockResolvedValue(err(databaseError()))
    expectErr(
      await enrichPrimaryFromSecondary(
        'ws1',
        createFakeSdInventoryDevice({ mergedIntoId: 'p' }),
      ),
      'DATABASE_ERROR',
    )
  })
})
