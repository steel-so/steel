import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeSdInventoryDevice,
  createFakeSdInventoryToken,
  createSdInventoryReport,
  sdInventoryToken,
} from '@/src/__tests__/factories/nov-s1-asset-inventory.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/repositories/sd-inventory-token.repository')
vi.mock('../sd-inventory-sync.service')
vi.mock('../sd-remote.service')

import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { SdInventoryTokenRepository } from '@/src/repositories/sd-inventory-token.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { SdInventoryIngestService } from '../sd-inventory-ingest.service'
import { syncInventoryDevice } from '../sd-inventory-sync.service'
import { SdRemoteService } from '../sd-remote.service'

const tokens = vi.mocked(SdInventoryTokenRepository)
const sync = vi.mocked(syncInventoryDevice)
const moduleEnabled = vi.mocked(WorkspaceModuleAccessRepository.isEnabled)
const { token, hash } = sdInventoryToken()

function synced(overrides?: { created?: boolean }) {
  return ok({
    device: createFakeSdInventoryDevice(),
    created: overrides?.created ?? true,
    configItemId: 'ci-1',
    openedAlerts: 1,
    resolvedAlerts: 2,
  })
}

beforeEach(() => {
  tokens.findActiveByHash.mockResolvedValue(ok(createFakeSdInventoryToken()))
  tokens.touch.mockResolvedValue(ok(undefined))
  moduleEnabled.mockResolvedValue(ok(true))
  sync.mockResolvedValue(synced())
})

describe('SdInventoryIngestService.ingest remote ids (S4)', () => {
  it('forwards the remote ids the agent found to the CMDB item', async () => {
    vi.mocked(SdRemoteService.saveInventoryEndpoints).mockResolvedValue(ok(1))
    await SdInventoryIngestService.ingest(
      token,
      createSdInventoryReport({ remote: { rustdesk: '123456789' } }),
    )
    expect(SdRemoteService.saveInventoryEndpoints).toHaveBeenCalledWith(
      'ws1',
      'ci-1',
      { rustdesk: '123456789' },
    )
  })

  it('still accepts the report when saving the remote ids fails', async () => {
    vi.mocked(SdRemoteService.saveInventoryEndpoints).mockResolvedValue(
      err(databaseError()),
    )
    expectOk(
      await SdInventoryIngestService.ingest(
        token,
        createSdInventoryReport({ remote: { anydesk: '987654321' } }),
      ),
    )
    expect(logger.warn).toHaveBeenCalledWith(
      'servicedesk.inventory.remote_ids_failed',
      expect.objectContaining({ workspaceId: 'ws1' }),
    )
  })

  it('skips the remote ids when there is no CMDB item or none were sent', async () => {
    sync.mockResolvedValue(
      ok({
        device: createFakeSdInventoryDevice(),
        created: false,
        configItemId: null,
        openedAlerts: 0,
        resolvedAlerts: 0,
      }),
    )
    await SdInventoryIngestService.ingest(
      token,
      createSdInventoryReport({ remote: { rustdesk: '123456789' } }),
    )
    await SdInventoryIngestService.ingest(token, createSdInventoryReport())
    expect(SdRemoteService.saveInventoryEndpoints).not.toHaveBeenCalled()
  })
})

describe('SdInventoryIngestService.ingest', () => {
  it('resolves the workspace from the token hash and syncs the device', async () => {
    const result = expectOk(
      await SdInventoryIngestService.ingest(token, createSdInventoryReport()),
    )
    expect(tokens.findActiveByHash).toHaveBeenCalledWith(hash)
    expect(result).toEqual({
      deviceId: 'dev-1',
      configItemId: 'ci-1',
      created: true,
      openedAlerts: 1,
      resolvedAlerts: 2,
    })
    expect(tokens.touch).toHaveBeenCalledWith('tok-1', expect.any(Date))
    expect(auditMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'sd_config_item',
        meta: expect.objectContaining({
          origin: 'inventory-agent',
          workspaceId: 'ws1',
        }),
      }),
    )
  })

  it('normalizes the report into the sync input', async () => {
    await SdInventoryIngestService.ingest(
      token,
      createSdInventoryReport({
        ipAddresses: ['10.0.0.1', '10.0.0.1'],
        macAddresses: ['AA-BB-CC-DD-EE-FF', 'aa:bb:cc:dd:ee:ff', 'garbage'],
      }),
    )
    const [workspaceId, actorId, payload] = sync.mock.calls[0] ?? []
    expect(workspaceId).toBe('ws1')
    expect(actorId).toBe('u1')
    expect(payload).toMatchObject({
      source: 'AGENT',
      externalKey: 'agent:abcdefgh-1234',
      hostname: 'PC-RECEPCAO',
      osName: 'Windows 11 Pro',
      ipAddresses: ['10.0.0.1'],
      macAddresses: ['aa:bb:cc:dd:ee:ff'],
      tokenId: 'tok-1',
      snmpTargetId: null,
      customerId: null,
      software: [{ name: 'Firefox', version: '130.0', publisher: 'Mozilla' }],
    })
  })

  it('maps missing hardware facts to nulls', async () => {
    await SdInventoryIngestService.ingest(
      token,
      createSdInventoryReport({
        hardware: {
          manufacturer: null,
          model: null,
          serialNumber: null,
          cpuModel: null,
        },
      }),
    )
    expect(sync.mock.calls[0]?.[2]).toMatchObject({
      manufacturer: null,
      model: null,
      serialNumber: null,
      cpuModel: null,
      cpuCores: null,
      ramTotalMb: null,
      ramUsedMb: null,
    })
  })

  it('does not audit a repeat report of a known device', async () => {
    sync.mockResolvedValue(synced({ created: false }))
    expectOk(
      await SdInventoryIngestService.ingest(token, createSdInventoryReport()),
    )
    expect(auditMutation).not.toHaveBeenCalled()
  })

  it('rejects an unknown or revoked token without syncing', async () => {
    tokens.findActiveByHash.mockResolvedValue(ok(null))
    expectErr(
      await SdInventoryIngestService.ingest(token, createSdInventoryReport()),
      'SD_INVENTORY_TOKEN_INVALID',
    )
    expect(sync).not.toHaveBeenCalled()
  })

  it('rejects when the ServiceDesk module is off for the workspace', async () => {
    moduleEnabled.mockResolvedValue(ok(false))
    expectErr(
      await SdInventoryIngestService.ingest(token, createSdInventoryReport()),
      'MODULE_DISABLED',
    )
    expect(sync).not.toHaveBeenCalled()
  })

  it('propagates a token lookup failure', async () => {
    tokens.findActiveByHash.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdInventoryIngestService.ingest(token, createSdInventoryReport()),
      'DATABASE_ERROR',
    )
  })

  it('propagates a module lookup failure', async () => {
    moduleEnabled.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdInventoryIngestService.ingest(token, createSdInventoryReport()),
      'DATABASE_ERROR',
    )
  })

  it('logs and propagates a sync failure', async () => {
    sync.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdInventoryIngestService.ingest(token, createSdInventoryReport()),
      'DATABASE_ERROR',
    )
    expect(logger.error).toHaveBeenCalledWith(
      'servicedesk.inventory.ingest_failed',
      expect.objectContaining({ workspaceId: 'ws1', tokenId: 'tok-1' }),
    )
    expect(tokens.touch).not.toHaveBeenCalled()
  })

  it('still succeeds when stamping the last use fails', async () => {
    tokens.touch.mockResolvedValue(err(databaseError()))
    expectOk(
      await SdInventoryIngestService.ingest(token, createSdInventoryReport()),
    )
    expect(logger.warn).toHaveBeenCalledWith(
      'servicedesk.inventory.token_touch_failed',
      { tokenId: 'tok-1' },
    )
  })
})
