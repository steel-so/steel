import type { PlatformZapiLine } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeUser } from '@/src/__tests__/factories/user.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/platform-zapi-line.repository')
vi.mock('@/src/repositories/user.repository')
vi.mock('@/src/lib/admin-audit', () => ({ recordAdminAction: vi.fn() }))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/lib/crypto', () => ({
  encryptConnectionSecret: vi.fn(async (value: string) => `enc:${value}`),
  decryptConnectionSecret: vi.fn(async (value: string) =>
    value.replace(/^enc:/, ''),
  ),
}))

const { getQrCode } = vi.hoisted(() => ({ getQrCode: vi.fn() }))
vi.mock('@/src/lib/whatsapp/zapi-client', () => ({
  createZapiClient: vi.fn(() => ({ getQrCode })),
  disconnectZapiInstance: vi.fn(),
  getZapiInstancePhone: vi.fn(),
  getZapiInstanceStatus: vi.fn(),
  restartZapiInstance: vi.fn(),
}))

import { recordAdminAction } from '@/src/lib/admin-audit'
import {
  createZapiClient,
  disconnectZapiInstance,
  getZapiInstancePhone,
  getZapiInstanceStatus,
  restartZapiInstance,
} from '@/src/lib/whatsapp/zapi-client'
import { PlatformZapiLineRepository } from '@/src/repositories/platform-zapi-line.repository'
import { UserRepository } from '@/src/repositories/user.repository'
import {
  CONNECTED_STATUS_FRESH_MS,
  OFFLINE_STATUS_FRESH_MS,
  PLATFORM_LINE_UNAVAILABLE_MESSAGE,
  PlatformZapiLineService,
} from '../platform-zapi-line.service'

const repo = vi.mocked(PlatformZapiLineRepository)
const users = vi.mocked(UserRepository)
const audit = vi.mocked(recordAdminAction)
const statusOf = vi.mocked(getZapiInstanceStatus)
const phoneOf = vi.mocked(getZapiInstancePhone)

const admin = createFakeUser({
  id: 'admin1',
  isPlatformAdmin: true,
  email: 'admin@stratustelecom.com.br',
})
const regular = createFakeUser({ id: 'u1', email: 'user@example.com' })

const NOW = new Date('2026-11-18T12:00:00.000Z')

function line(overrides: Partial<PlatformZapiLine> = {}): PlatformZapiLine {
  return {
    id: 'default',
    instanceId: '3C4A5B6C7D8E9F00',
    encryptedToken: 'enc:secret-token',
    encryptedClientToken: 'enc:secret-client',
    label: 'Verificação',
    phone: null,
    status: 'DISCONNECTED',
    statusError: null,
    connectedAt: null,
    statusCheckedAt: NOW,
    updatedById: 'admin1',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

const CREDENTIALS = {
  instanceId: '3C4A5B6C7D8E9F00',
  token: 'secret-token',
  clientToken: 'secret-client',
}

beforeEach(() => {
  vi.clearAllMocks()
  users.findById.mockImplementation(async (id) =>
    ok(id === 'admin1' ? admin : regular),
  )
  repo.find.mockResolvedValue(ok(line()))
  repo.upsertCredentials.mockImplementation(async (data) =>
    ok(
      line({
        instanceId: data.instanceId,
        encryptedToken: data.encryptedToken,
        encryptedClientToken: data.encryptedClientToken,
        label: data.label,
      }),
    ),
  )
  // updateStatus echoes the saved state like the database would.
  repo.updateStatus.mockImplementation(async (data) =>
    ok(
      line({
        status: data.status,
        statusError: data.statusError ?? null,
        phone: data.phone ?? null,
        connectedAt: data.connectedAt ?? null,
      }),
    ),
  )
  repo.remove.mockResolvedValue(ok(undefined))
  vi.mocked(restartZapiInstance).mockResolvedValue(undefined)
  vi.mocked(disconnectZapiInstance).mockResolvedValue(undefined)
  statusOf.mockResolvedValue({ connected: false, error: null })
  phoneOf.mockResolvedValue('5511999990000')
  getQrCode.mockResolvedValue({ status: 'awaiting_scan', qrCodeBase64: 'qr' })
})

describe('authorization (platform admin only)', () => {
  it('refuses every admin operation to a regular user', async () => {
    const input = { reason: 'because' }
    for (const result of [
      await PlatformZapiLineService.get('u1'),
      await PlatformZapiLineService.save('u1', {
        instanceId: 'abc',
        token: 'tok',
      }),
      await PlatformZapiLineService.refreshStatus('u1'),
      await PlatformZapiLineService.getQrCode('u1'),
      await PlatformZapiLineService.restart('u1', input),
      await PlatformZapiLineService.disconnect('u1', input),
      await PlatformZapiLineService.remove('u1', input),
    ]) {
      expectErr(result, 'FORBIDDEN')
    }
    expect(repo.upsertCredentials).not.toHaveBeenCalled()
    expect(repo.remove).not.toHaveBeenCalled()
    expect(restartZapiInstance).not.toHaveBeenCalled()
    expect(disconnectZapiInstance).not.toHaveBeenCalled()
    expect(createZapiClient).not.toHaveBeenCalled()
  })
})

describe('get()', () => {
  it('reports a not configured line', async () => {
    repo.find.mockResolvedValue(ok(null))
    const value = expectOk(await PlatformZapiLineService.get('admin1'))
    expect(value.configured).toBe(false)
    expect(value.status).toBeNull()
  })

  it('returns only the masked instance id and never a token', async () => {
    const value = expectOk(await PlatformZapiLineService.get('admin1'))
    expect(value.configured).toBe(true)
    expect(value.instanceIdMasked).toBe('3C4A****9F00')
    expect(value.hasClientToken).toBe(true)
    const json = JSON.stringify(value)
    expect(json).not.toContain('secret-token')
    expect(json).not.toContain('secret-client')
    expect(json).not.toContain('3C4A5B6C7D8E9F00')
    expect(json).not.toContain('encrypted')
  })

  it('propagates a database failure', async () => {
    repo.find.mockResolvedValue(err(databaseError('x')))
    expectErr(await PlatformZapiLineService.get('admin1'), 'DATABASE_ERROR')
  })
})

describe('save()', () => {
  it('stores the tokens encrypted, audits it and returns no secret', async () => {
    repo.find.mockResolvedValue(ok(null))
    const value = expectOk(
      await PlatformZapiLineService.save('admin1', {
        instanceId: 'INST123456789',
        token: 'plain-token',
        clientToken: 'plain-client',
        label: 'Linha',
      }),
    )

    expect(repo.upsertCredentials).toHaveBeenCalledWith({
      instanceId: 'INST123456789',
      encryptedToken: 'enc:plain-token',
      encryptedClientToken: 'enc:plain-client',
      label: 'Linha',
      updatedById: 'admin1',
    })
    expect(value.status).toBe('DISCONNECTED')
    const json = JSON.stringify(value)
    expect(json).not.toContain('plain-token')
    expect(json).not.toContain('plain-client')
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'zapi_line.configure',
        audit: { entity: 'platform_zapi_line', action: 'create' },
      }),
    )
    expect(JSON.stringify(audit.mock.calls)).not.toContain('plain-token')
  })

  it('replaces the credentials without a client token and audits a replacement', async () => {
    expectOk(
      await PlatformZapiLineService.save('admin1', {
        instanceId: 'NEWINSTANCE1',
        token: 'new-token',
      }),
    )
    expect(repo.upsertCredentials).toHaveBeenCalledWith(
      expect.objectContaining({
        encryptedClientToken: null,
        label: null,
      }),
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'zapi_line.replace_credentials' }),
    )
  })

  it('propagates storage failures without auditing', async () => {
    repo.upsertCredentials.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await PlatformZapiLineService.save('admin1', {
        instanceId: 'abc',
        token: 'tok',
      }),
      'DATABASE_ERROR',
    )
    expect(audit).not.toHaveBeenCalled()
  })

  it('propagates a failure reading the previous line', async () => {
    repo.find.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await PlatformZapiLineService.save('admin1', {
        instanceId: 'abc',
        token: 'tok',
      }),
      'DATABASE_ERROR',
    )
  })
})

describe('refreshStatus()', () => {
  it('is not configured when there is no line', async () => {
    repo.find.mockResolvedValue(ok(null))
    expect(
      expectOk(await PlatformZapiLineService.refreshStatus('admin1'))
        .configured,
    ).toBe(false)
  })

  it('saves CONNECTED with the number once Z-API reports the phone paired', async () => {
    statusOf.mockResolvedValue({ connected: true, error: null })
    const value = expectOk(
      await PlatformZapiLineService.refreshStatus('admin1'),
    )
    expect(statusOf).toHaveBeenCalledWith(CREDENTIALS)
    expect(repo.updateStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'CONNECTED', phone: '5511999990000' }),
      'admin1',
    )
    expect(value.status).toBe('CONNECTED')
    expect(value.phone).toBe('5511999990000')
  })

  it('still connects when the number lookup fails', async () => {
    statusOf.mockResolvedValue({ connected: true, error: null })
    phoneOf.mockRejectedValue(new Error('x'))
    expect(
      expectOk(await PlatformZapiLineService.refreshStatus('admin1')).status,
    ).toBe('CONNECTED')
  })

  it('keeps AWAITING_QR while a scan is pending, else DISCONNECTED', async () => {
    repo.find.mockResolvedValue(ok(line({ status: 'AWAITING_QR' })))
    expect(
      expectOk(await PlatformZapiLineService.refreshStatus('admin1')).status,
    ).toBe('AWAITING_QR')
    repo.find.mockResolvedValue(ok(line({ status: 'CONNECTED' })))
    expect(
      expectOk(await PlatformZapiLineService.refreshStatus('admin1')).status,
    ).toBe('DISCONNECTED')
  })

  it('turns a provider failure into the ERROR state with its reason', async () => {
    statusOf.mockRejectedValue(new Error('Token inválido'))
    const value = expectOk(
      await PlatformZapiLineService.refreshStatus('admin1'),
    )
    expect(value.status).toBe('ERROR')
    expect(value.statusError).toBe('Token inválido')
  })

  it('answers not found when the line vanished while updating', async () => {
    repo.updateStatus.mockResolvedValue(ok(null))
    expectErr(
      await PlatformZapiLineService.refreshStatus('admin1'),
      'RESOURCE_NOT_FOUND',
    )
  })

  it('propagates storage failures', async () => {
    repo.updateStatus.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await PlatformZapiLineService.refreshStatus('admin1'),
      'DATABASE_ERROR',
    )
  })
})

describe('getQrCode()', () => {
  it('returns the QR code and marks the line as waiting for the scan', async () => {
    const value = expectOk(await PlatformZapiLineService.getQrCode('admin1'))
    expect(createZapiClient).toHaveBeenCalledWith(CREDENTIALS)
    expect(value.status).toBe('awaiting_scan')
    expect(value.qrCodeBase64).toBe('qr')
    expect(value.line.status).toBe('AWAITING_QR')
  })

  it('reads the line back as connected once the phone is paired', async () => {
    getQrCode.mockResolvedValue({ status: 'connected' })
    statusOf.mockResolvedValue({ connected: true, error: null })
    const value = expectOk(await PlatformZapiLineService.getQrCode('admin1'))
    expect(value.status).toBe('connected')
    expect(value.qrCodeBase64).toBeUndefined()
    expect(value.line.status).toBe('CONNECTED')
  })

  it('surfaces the provider reason and saves the ERROR state', async () => {
    getQrCode.mockRejectedValue(new Error('Client-Token inválido'))
    const error = expectErr(
      await PlatformZapiLineService.getQrCode('admin1'),
      'WHATSAPP_PROVIDER_ERROR',
    )
    expect(error.message).toBe('Client-Token inválido')
    expect(repo.updateStatus).toHaveBeenCalledWith(
      { status: 'ERROR', statusError: 'Client-Token inválido' },
      'admin1',
    )
  })

  it('answers not found without a configured line', async () => {
    repo.find.mockResolvedValue(ok(null))
    expectErr(
      await PlatformZapiLineService.getQrCode('admin1'),
      'RESOURCE_NOT_FOUND',
    )
  })

  it('propagates storage failures', async () => {
    repo.updateStatus.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await PlatformZapiLineService.getQrCode('admin1'),
      'DATABASE_ERROR',
    )
  })
})

describe('restart() and disconnect()', () => {
  it('restarts, audits with the reason and reads the state back', async () => {
    statusOf.mockResolvedValue({ connected: true, error: null })
    const value = expectOk(
      await PlatformZapiLineService.restart('admin1', { reason: 'travou' }),
    )
    expect(restartZapiInstance).toHaveBeenCalledWith(CREDENTIALS)
    expect(value.status).toBe('CONNECTED')
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'zapi_line.restart',
        reason: 'travou',
      }),
    )
  })

  it('reports a provider failure on restart without auditing', async () => {
    vi.mocked(restartZapiInstance).mockRejectedValue(new Error('fora do ar'))
    expectErr(
      await PlatformZapiLineService.restart('admin1', { reason: 'travou' }),
      'WHATSAPP_PROVIDER_ERROR',
    )
    expect(audit).not.toHaveBeenCalled()
  })

  it('unpairs the phone, clears the number and audits it', async () => {
    const value = expectOk(
      await PlatformZapiLineService.disconnect('admin1', {
        reason: 'trocar número',
      }),
    )
    expect(disconnectZapiInstance).toHaveBeenCalledWith(CREDENTIALS)
    expect(repo.updateStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'DISCONNECTED',
        phone: null,
        connectedAt: null,
      }),
      'admin1',
    )
    expect(value.status).toBe('DISCONNECTED')
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'zapi_line.disconnect' }),
    )
  })

  it('keeps the state when Z-API refuses to disconnect', async () => {
    vi.mocked(disconnectZapiInstance).mockRejectedValue(new Error('nope'))
    expectErr(
      await PlatformZapiLineService.disconnect('admin1', { reason: 'motivo' }),
      'WHATSAPP_PROVIDER_ERROR',
    )
    expect(repo.updateStatus).not.toHaveBeenCalled()
  })

  it('answers not found without a configured line', async () => {
    repo.find.mockResolvedValue(ok(null))
    expectErr(
      await PlatformZapiLineService.disconnect('admin1', { reason: 'motivo' }),
      'RESOURCE_NOT_FOUND',
    )
  })
})

describe('remove()', () => {
  it('forgets the credentials and audits it', async () => {
    const value = expectOk(
      await PlatformZapiLineService.remove('admin1', { reason: 'desativar' }),
    )
    expect(repo.remove).toHaveBeenCalled()
    expect(value.configured).toBe(false)
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'zapi_line.remove',
        audit: { entity: 'platform_zapi_line', action: 'delete' },
      }),
    )
  })

  it('propagates storage failures', async () => {
    repo.remove.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await PlatformZapiLineService.remove('admin1', { reason: 'desativar' }),
      'DATABASE_ERROR',
    )
  })
})

describe('isAvailable() (what workspaces see)', () => {
  const fresh = NOW.getTime() + 1000

  it('is false when no line is configured', async () => {
    repo.find.mockResolvedValue(ok(null))
    expect(expectOk(await PlatformZapiLineService.isAvailable(fresh))).toBe(
      false,
    )
  })

  it('is true for a recently confirmed connected line, without asking Z-API', async () => {
    repo.find.mockResolvedValue(ok(line({ status: 'CONNECTED' })))
    expect(expectOk(await PlatformZapiLineService.isAvailable(fresh))).toBe(
      true,
    )
    expect(statusOf).not.toHaveBeenCalled()
  })

  it('is false for a recently confirmed disconnected line, without asking Z-API', async () => {
    expect(expectOk(await PlatformZapiLineService.isAvailable(fresh))).toBe(
      false,
    )
    expect(statusOf).not.toHaveBeenCalled()
  })

  it('re-checks a stale connected line and turns false when it dropped', async () => {
    repo.find.mockResolvedValue(ok(line({ status: 'CONNECTED' })))
    const later = NOW.getTime() + CONNECTED_STATUS_FRESH_MS + 1
    expect(expectOk(await PlatformZapiLineService.isAvailable(later))).toBe(
      false,
    )
    expect(statusOf).toHaveBeenCalledTimes(1)
  })

  it('re-checks a stale offline line sooner and turns true when it came back', async () => {
    statusOf.mockResolvedValue({ connected: true, error: null })
    const later = NOW.getTime() + OFFLINE_STATUS_FRESH_MS + 1
    expect(expectOk(await PlatformZapiLineService.isAvailable(later))).toBe(
      true,
    )
  })

  it('propagates storage failures', async () => {
    repo.find.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await PlatformZapiLineService.isAvailable(fresh),
      'DATABASE_ERROR',
    )
  })

  it('reports a decryption failure as a database error', async () => {
    const { decryptConnectionSecret } = await import('@/src/lib/crypto')
    vi.mocked(decryptConnectionSecret).mockRejectedValueOnce(new Error('key'))
    expectErr(
      await PlatformZapiLineService.isAvailable(fresh),
      'DATABASE_ERROR',
    )
  })
})

describe('acquireForValidation()', () => {
  it('fails with the clear message when no line exists', async () => {
    repo.find.mockResolvedValue(ok(null))
    const error = expectErr(
      await PlatformZapiLineService.acquireForValidation(),
      'WHATSAPP_VALIDATION_UNAVAILABLE',
    )
    expect(error.message).toBe(PLATFORM_LINE_UNAVAILABLE_MESSAGE)
  })

  it('checks the line live and fails when it is not connected', async () => {
    const error = expectErr(
      await PlatformZapiLineService.acquireForValidation(),
      'WHATSAPP_VALIDATION_UNAVAILABLE',
    )
    expect(statusOf).toHaveBeenCalledTimes(1)
    expect(error.message).toContain('peça a um administrador da plataforma')
  })

  it('returns the decrypted credentials when connected', async () => {
    statusOf.mockResolvedValue({ connected: true, error: null })
    expect(
      expectOk(await PlatformZapiLineService.acquireForValidation()),
    ).toEqual(CREDENTIALS)
  })

  it('propagates storage failures', async () => {
    repo.find.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await PlatformZapiLineService.acquireForValidation(),
      'DATABASE_ERROR',
    )
  })

  it('treats a provider failure (ERROR state) as unavailable', async () => {
    statusOf.mockRejectedValue(new Error('timeout'))
    expectErr(
      await PlatformZapiLineService.acquireForValidation(),
      'WHATSAPP_VALIDATION_UNAVAILABLE',
    )
  })

  it('propagates a failure saving the live state', async () => {
    repo.updateStatus.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await PlatformZapiLineService.acquireForValidation(),
      'DATABASE_ERROR',
    )
  })
})

describe('isLineLost() (mid-run guard)', () => {
  it('is false while Z-API says the phone is paired', async () => {
    statusOf.mockResolvedValue({ connected: true, error: null })
    expect(await PlatformZapiLineService.isLineLost(CREDENTIALS)).toBe(false)
    expect(repo.updateStatus).not.toHaveBeenCalled()
  })

  it('is true and marks the line disconnected when the phone was unpaired', async () => {
    statusOf.mockResolvedValue({
      connected: false,
      error: 'You are not connected.',
    })
    expect(await PlatformZapiLineService.isLineLost(CREDENTIALS)).toBe(true)
    expect(repo.updateStatus).toHaveBeenCalledWith({
      status: 'DISCONNECTED',
      statusError: null,
      phone: null,
      connectedAt: null,
    })
  })

  it('is not "lost" on a provider error (the chunk itself is retried)', async () => {
    statusOf.mockRejectedValue(new Error('network'))
    expect(await PlatformZapiLineService.isLineLost(CREDENTIALS)).toBe(false)
    expect(repo.updateStatus).not.toHaveBeenCalled()
  })

  it('handles a non-Error provider failure', async () => {
    statusOf.mockRejectedValue('boom')
    expect(await PlatformZapiLineService.isLineLost(CREDENTIALS)).toBe(false)
  })
})
