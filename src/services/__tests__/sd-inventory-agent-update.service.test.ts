import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSdInventoryAgentRelease } from '@/src/__tests__/factories/nov-inventory-followups.factory'
import {
  createFakeSdInventorySettings,
  createFakeSdInventoryToken,
  sdInventoryToken,
} from '@/src/__tests__/factories/nov-s1-asset-inventory.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { actAs } from '@/src/__tests__/helpers/sd-config.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/sd-access.repository')
vi.mock('@/src/repositories/sd-inventory-release.repository')
vi.mock('@/src/repositories/sd-inventory-settings.repository')
vi.mock('@/src/repositories/sd-inventory-token.repository')
vi.mock('@/src/lib/storage/s3', () => ({
  ensureBucket: vi.fn(),
  getObject: vi.fn(),
  putObject: vi.fn(),
}))

import { ensureBucket, getObject, putObject } from '@/src/lib/storage/s3'
import { SdInventoryReleaseRepository } from '@/src/repositories/sd-inventory-release.repository'
import { SdInventorySettingsRepository } from '@/src/repositories/sd-inventory-settings.repository'
import { SdInventoryTokenRepository } from '@/src/repositories/sd-inventory-token.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import {
  SD_INVENTORY_AGENT_BUCKET,
  SdInventoryAgentUpdateService,
  sdInventoryAgentDownloadPath,
  sdInventoryAgentStorageKey,
} from '../sd-inventory-agent-update.service'

const releases = vi.mocked(SdInventoryReleaseRepository)
const settings = vi.mocked(SdInventorySettingsRepository)
const tokens = vi.mocked(SdInventoryTokenRepository)
const moduleEnabled = vi.mocked(WorkspaceModuleAccessRepository.isEnabled)
const { token } = sdInventoryToken()

const BINARY = Buffer.from('agent-binary-bytes')
const SHA = createHash('sha256').update(BINARY).digest('hex')
const query = { os: 'linux', arch: 'amd64', current: '2026.10.01' } as const

function autoUpdate(on: boolean) {
  settings.find.mockResolvedValue(
    ok(createFakeSdInventorySettings({ agentAutoUpdate: on })),
  )
}

beforeEach(() => {
  tokens.findActiveByHash.mockResolvedValue(ok(createFakeSdInventoryToken()))
  moduleEnabled.mockResolvedValue(ok(true))
  autoUpdate(true)
  releases.findLatest.mockResolvedValue(
    ok(createFakeSdInventoryAgentRelease({ sha256: SHA })),
  )
  releases.findExact.mockResolvedValue(
    ok(createFakeSdInventoryAgentRelease({ sha256: SHA })),
  )
  releases.upsert.mockResolvedValue(
    ok(createFakeSdInventoryAgentRelease({ sha256: SHA })),
  )
  releases.listLatestPerTarget.mockResolvedValue(
    ok([createFakeSdInventoryAgentRelease()]),
  )
  vi.mocked(getObject).mockReset().mockResolvedValue(BINARY)
  vi.mocked(putObject).mockReset().mockResolvedValue(undefined)
  vi.mocked(ensureBucket).mockReset().mockResolvedValue(undefined)
})

describe('helpers', () => {
  it('builds the storage key and the download path', () => {
    expect(
      sdInventoryAgentStorageKey({
        version: '1.2.3',
        os: 'windows',
        arch: 'amd64',
      }),
    ).toBe('1.2.3/steel-inventory-agent-windows-amd64.exe')
    expect(
      sdInventoryAgentStorageKey({
        version: '1.2.3',
        os: 'linux',
        arch: 'arm64',
      }),
    ).toBe('1.2.3/steel-inventory-agent-linux-arm64')
    expect(
      sdInventoryAgentDownloadPath({
        os: 'linux',
        arch: 'amd64',
        version: '1.2 3',
      }),
    ).toBe(
      '/api/servicedesk/inventory/agent/download?os=linux&arch=amd64&version=1.2+3',
    )
  })
})

describe('authorize', () => {
  it('rejects unknown tokens, disabled modules and lookup failures', async () => {
    tokens.findActiveByHash.mockResolvedValueOnce(ok(null))
    expectErr(
      await SdInventoryAgentUpdateService.authorize(token),
      'SD_INVENTORY_TOKEN_INVALID',
    )
    moduleEnabled.mockResolvedValueOnce(ok(false))
    expectErr(await SdInventoryAgentUpdateService.authorize(token))
    tokens.findActiveByHash.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SdInventoryAgentUpdateService.authorize(token),
      'DATABASE_ERROR',
    )
  })
})

describe('checkVersion', () => {
  it('offers the newest release with its checksum and download path', async () => {
    expect(
      expectOk(await SdInventoryAgentUpdateService.checkVersion(token, query)),
    ).toEqual({
      updateAvailable: true,
      version: '2026.11.01',
      sha256: SHA,
      size: 1024,
      downloadPath:
        '/api/servicedesk/inventory/agent/download?os=linux&arch=amd64&version=2026.11.01',
    })
    expect(releases.findLatest).toHaveBeenCalledWith('linux', 'amd64')
  })

  it('offers nothing when the workspace did not opt in', async () => {
    autoUpdate(false)
    expect(
      expectOk(await SdInventoryAgentUpdateService.checkVersion(token, query))
        .updateAvailable,
    ).toBe(false)
    expect(releases.findLatest).not.toHaveBeenCalled()
  })

  it('never updates a dev build, an up-to-date agent or an unreleased platform', async () => {
    expect(
      expectOk(
        await SdInventoryAgentUpdateService.checkVersion(token, {
          ...query,
          current: 'dev',
        }),
      ).updateAvailable,
    ).toBe(false)
    expect(
      expectOk(
        await SdInventoryAgentUpdateService.checkVersion(token, {
          ...query,
          current: '2026.11.01',
        }),
      ).updateAvailable,
    ).toBe(false)
    releases.findLatest.mockResolvedValue(ok(null))
    expect(
      expectOk(await SdInventoryAgentUpdateService.checkVersion(token, query))
        .updateAvailable,
    ).toBe(false)
  })

  it('propagates auth, settings and release failures', async () => {
    tokens.findActiveByHash.mockResolvedValueOnce(ok(null))
    expectErr(
      await SdInventoryAgentUpdateService.checkVersion(token, query),
      'SD_INVENTORY_TOKEN_INVALID',
    )
    settings.find.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SdInventoryAgentUpdateService.checkVersion(token, query),
      'DATABASE_ERROR',
    )
    releases.findLatest.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdInventoryAgentUpdateService.checkVersion(token, query),
      'DATABASE_ERROR',
    )
  })
})

describe('download', () => {
  const request = { os: 'linux', arch: 'amd64', version: '2026.11.01' } as const

  it('returns the binary when it matches the published checksum', async () => {
    const result = expectOk(
      await SdInventoryAgentUpdateService.download(token, request),
    )
    expect(result.body).toEqual(BINARY)
    expect(result.sha256).toBe(SHA)
    expect(result.filename).toBe('steel-inventory-agent-linux-amd64')
    expect(getObject).toHaveBeenCalledWith({
      bucket: SD_INVENTORY_AGENT_BUCKET,
      key: '2026.11.01/steel-inventory-agent-linux-amd64',
    })
  })

  it('refuses a corrupted file, a missing release and a storage failure', async () => {
    vi.mocked(getObject).mockResolvedValueOnce(Buffer.from('tampered'))
    expectErr(
      await SdInventoryAgentUpdateService.download(token, request),
      'SD_INVENTORY_RELEASE_INVALID',
    )
    releases.findExact.mockResolvedValueOnce(ok(null))
    expectErr(
      await SdInventoryAgentUpdateService.download(token, request),
      'SD_INVENTORY_RELEASE_INVALID',
    )
    vi.mocked(getObject).mockRejectedValueOnce(new Error('s3 down'))
    expectErr(
      await SdInventoryAgentUpdateService.download(token, request),
      'SD_INVENTORY_RELEASE_INVALID',
    )
    vi.mocked(getObject).mockRejectedValueOnce('s3 down')
    expectErr(
      await SdInventoryAgentUpdateService.download(token, request),
      'SD_INVENTORY_RELEASE_INVALID',
    )
  })

  it('refuses when the workspace did not opt in', async () => {
    autoUpdate(false)
    expectErr(
      await SdInventoryAgentUpdateService.download(token, request),
      'SD_INVENTORY_RELEASE_INVALID',
    )
    expect(getObject).not.toHaveBeenCalled()
  })

  it('propagates auth, settings and release lookup failures', async () => {
    tokens.findActiveByHash.mockResolvedValueOnce(ok(null))
    expectErr(
      await SdInventoryAgentUpdateService.download(token, request),
      'SD_INVENTORY_TOKEN_INVALID',
    )
    settings.find.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SdInventoryAgentUpdateService.download(token, request),
      'DATABASE_ERROR',
    )
    releases.findExact.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SdInventoryAgentUpdateService.download(token, request),
      'DATABASE_ERROR',
    )
  })
})

describe('listLatest', () => {
  it('lists the newest releases for admins only', async () => {
    actAs('owner')
    expect(
      expectOk(await SdInventoryAgentUpdateService.listLatest('u1', 'ws1')),
    ).toHaveLength(1)
    releases.listLatestPerTarget.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await SdInventoryAgentUpdateService.listLatest('u1', 'ws1'),
      'DATABASE_ERROR',
    )
    actAs('agent')
    expectErr(
      await SdInventoryAgentUpdateService.listLatest('u1', 'ws1'),
      'FORBIDDEN',
    )
  })
})

describe('publish', () => {
  const input = {
    version: '2026.11.01',
    os: 'linux',
    arch: 'amd64',
    binary: BINARY,
  } as const

  it('stores the binary privately and records its checksum', async () => {
    const dto = expectOk(await SdInventoryAgentUpdateService.publish(input))
    expect(ensureBucket).toHaveBeenCalledWith(SD_INVENTORY_AGENT_BUCKET)
    expect(putObject).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: SD_INVENTORY_AGENT_BUCKET,
        key: '2026.11.01/steel-inventory-agent-linux-amd64',
        body: BINARY,
      }),
    )
    expect(releases.upsert).toHaveBeenCalledWith({
      version: '2026.11.01',
      os: 'linux',
      arch: 'amd64',
      sha256: SHA,
      sizeBytes: BINARY.length,
      storageKey: '2026.11.01/steel-inventory-agent-linux-amd64',
    })
    expect(dto).not.toHaveProperty('storageKey')
  })

  it('rejects a bad version, an empty or oversized binary', async () => {
    expectErr(
      await SdInventoryAgentUpdateService.publish({
        ...input,
        version: 'a b/c',
      }),
      'SD_INVENTORY_RELEASE_INVALID',
    )
    expectErr(
      await SdInventoryAgentUpdateService.publish({
        ...input,
        os: 'plan9' as never,
      }),
      'SD_INVENTORY_RELEASE_INVALID',
    )
    expectErr(
      await SdInventoryAgentUpdateService.publish({
        ...input,
        binary: Buffer.alloc(0),
      }),
      'SD_INVENTORY_RELEASE_INVALID',
    )
    expectErr(
      await SdInventoryAgentUpdateService.publish({
        ...input,
        binary: { length: 70 * 1024 * 1024 } as Buffer,
      }),
      'SD_INVENTORY_RELEASE_INVALID',
    )
    expect(putObject).not.toHaveBeenCalled()
  })

  it('reports storage and database failures', async () => {
    vi.mocked(putObject).mockRejectedValueOnce(new Error('s3 down'))
    expectErr(
      await SdInventoryAgentUpdateService.publish(input),
      'SD_INVENTORY_RELEASE_INVALID',
    )
    vi.mocked(putObject).mockRejectedValueOnce('s3 down')
    expectErr(
      await SdInventoryAgentUpdateService.publish(input),
      'SD_INVENTORY_RELEASE_INVALID',
    )
    releases.upsert.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdInventoryAgentUpdateService.publish(input),
      'DATABASE_ERROR',
    )
  })
})
