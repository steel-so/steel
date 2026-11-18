import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/whatsapp-connection.repository')
vi.mock('@/src/repositories/whatsapp-contact.repository')
vi.mock('@/src/repositories/whatsapp-broadcast.repository')
vi.mock('@/src/repositories/whatsapp-ai-campaign.repository')
vi.mock('@/src/repositories/whatsapp-number-validation.repository')
vi.mock('../whatsapp-settings.service')
vi.mock('@/src/lib/crypto', () => ({
  decryptConnectionSecret: vi.fn(async (value: string) => `dec:${value}`),
}))
vi.mock('@/src/lib/whatsapp/zapi-client', () => ({
  checkZapiPhonesBatch: vi.fn(),
}))

const { platformCreds, acquireLease, reserveBudget, release, renew } =
  vi.hoisted(() => ({
    platformCreds: vi.fn(),
    acquireLease: vi.fn(),
    reserveBudget: vi.fn(),
    release: vi.fn(async () => {}),
    renew: vi.fn(async () => {}),
  }))
vi.mock('@/src/lib/whatsapp/validation-instance', () => ({
  PLATFORM_VALIDATION_CONNECTION_ID: 'platform',
  getPlatformZapiCredentials: platformCreds,
}))
vi.mock('@/src/lib/whatsapp/validation-throttle', () => ({
  acquirePlatformLease: acquireLease,
  reservePlatformBudget: reserveBudget,
}))

const { add } = vi.hoisted(() => ({ add: vi.fn(async () => ({})) }))
vi.mock('@/src/lib/queue/queues', () => ({
  getWhatsappBroadcastQueue: vi.fn(() => ({ add })),
}))

import { checkZapiPhonesBatch } from '@/src/lib/whatsapp/zapi-client'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import { WhatsAppNumberValidationRepository } from '@/src/repositories/whatsapp-number-validation.repository'
import {
  resolveValidationSource,
  WhatsAppContactValidationService,
} from '../whatsapp-contact-validation.service'
import { WhatsAppSettingsService } from '../whatsapp-settings.service'

const membershipRepo = vi.mocked(MembershipRepository)
const connectionRepo = vi.mocked(WhatsAppConnectionRepository)
const contactRepo = vi.mocked(WhatsAppContactRepository)
const runRepo = vi.mocked(WhatsAppNumberValidationRepository)
const settingsService = vi.mocked(WhatsAppSettingsService)
const batch = vi.mocked(checkZapiPhonesBatch)

const PLATFORM = {
  instanceId: 'platform-inst',
  token: 'platform-token',
  clientToken: 'platform-client',
}
const ownZapi = createFakeWhatsAppConnection({
  id: 'conn-z',
  workspaceId: 'ws1',
  provider: 'ZAPI',
  status: 'CONNECTED',
})
const meta = createFakeWhatsAppConnection({
  id: 'conn-m',
  workspaceId: 'ws1',
  provider: 'META',
  status: 'CONNECTED',
  zapiInstanceId: null,
  encryptedZapiToken: null,
})
const stale = { hasWhatsapp: null, whatsappCheckedAt: null }

function run(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run1',
    workspaceId: 'ws1',
    connectionId: 'platform',
    requestedById: 'u1',
    scope: 'CONTACTS' as const,
    scopeId: null,
    status: 'QUEUED' as const,
    contactIds: ['c1', 'c2'],
    force: false,
    total: 2,
    processed: 0,
    withWhatsapp: 0,
    withoutWhatsapp: 0,
    failed: 0,
    cached: 0,
    errorMessage: null,
    startedAt: null,
    finishedAt: null,
    createdAt: new Date('2026-11-18T12:00:00.000Z'),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  membershipRepo.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role: 'MEMBER' })),
  )
  platformCreds.mockReturnValue(PLATFORM)
  acquireLease.mockResolvedValue({ release, renew })
  reserveBudget.mockResolvedValue(true)
  connectionRepo.listByWorkspace.mockResolvedValue(ok([meta]))
  runRepo.findActive.mockResolvedValue(ok(null))
  runRepo.create.mockImplementation(async (data) =>
    ok(
      run({
        connectionId: data.connectionId,
        contactIds: data.contactIds,
        total: data.contactIds.length,
      }),
    ),
  )
  runRepo.markRunning.mockResolvedValue(ok(true))
  runRepo.addProgress.mockResolvedValue(ok(undefined))
  runRepo.finish.mockResolvedValue(ok(undefined))
  runRepo.resetProgress.mockResolvedValue(ok(undefined))
  settingsService.getEffective.mockResolvedValue(
    ok({ whatsappCheckTtlDays: 30 } as never),
  )
  batch.mockReset()
  batch.mockResolvedValue({ results: [], failed: [], invalid: [] })
})

describe('resolveValidationSource() — selection rule', () => {
  it('prefers the own connected Z-API connection (no load on the platform)', async () => {
    connectionRepo.listByWorkspace.mockResolvedValue(ok([meta, ownZapi]))
    expect(expectOk(await resolveValidationSource('ws1'))).toEqual({
      kind: 'WORKSPACE',
      connectionId: 'conn-z',
    })
  })

  it('falls back to the platform instance for a Meta-only workspace', async () => {
    expect(expectOk(await resolveValidationSource('ws1'))).toEqual({
      kind: 'PLATFORM',
      connectionId: 'platform',
    })
  })

  it('falls back to the platform when the own Z-API is disconnected', async () => {
    connectionRepo.listByWorkspace.mockResolvedValue(
      ok([{ ...ownZapi, status: 'DISCONNECTED' }]),
    )
    expect(expectOk(await resolveValidationSource('ws1')).kind).toBe('PLATFORM')
  })

  it('errors when neither exists, saying validation is unavailable', async () => {
    platformCreds.mockReturnValue(null)
    const error = expectErr(
      await resolveValidationSource('ws1'),
      'WHATSAPP_VALIDATION_UNAVAILABLE',
    )
    expect(error.message).toContain('não está disponível')
  })

  it('reports the disconnected instance when there is no platform instance', async () => {
    platformCreds.mockReturnValue(null)
    connectionRepo.listByWorkspace.mockResolvedValue(
      ok([{ ...ownZapi, status: 'DISCONNECTED' }]),
    )
    const error = expectErr(
      await resolveValidationSource('ws1'),
      'WHATSAPP_VALIDATION_UNAVAILABLE',
    )
    expect(error.message).toContain('Reconecte')
  })

  it('never falls back to the platform when a connection is forced', async () => {
    connectionRepo.listByWorkspace.mockResolvedValue(ok([meta]))
    expectErr(
      await resolveValidationSource('ws1', 'conn-m'),
      'WHATSAPP_VALIDATION_UNAVAILABLE',
    )
    connectionRepo.listByWorkspace.mockResolvedValue(
      ok([{ ...ownZapi, status: 'DISCONNECTED' }]),
    )
    expectErr(
      await resolveValidationSource('ws1', 'conn-z'),
      'WHATSAPP_VALIDATION_UNAVAILABLE',
    )
  })

  it('propagates a listing failure', async () => {
    connectionRepo.listByWorkspace.mockResolvedValue(err(databaseError('x')))
    expectErr(await resolveValidationSource('ws1'), 'DATABASE_ERROR')
  })
})

describe('availability()', () => {
  it('reports the platform source for a Meta-only workspace', async () => {
    expect(
      expectOk(
        await WhatsAppContactValidationService.availability('u1', 'ws1'),
      ),
    ).toEqual({ available: true, source: 'PLATFORM' })
  })

  it('reports the workspace source and never leaks credentials', async () => {
    connectionRepo.listByWorkspace.mockResolvedValue(ok([ownZapi]))
    const value = expectOk(
      await WhatsAppContactValidationService.availability('u1', 'ws1'),
    )
    expect(value).toEqual({ available: true, source: 'WORKSPACE' })
    expect(JSON.stringify(value)).not.toContain('platform-token')
  })

  it('reports unavailable when neither exists', async () => {
    platformCreds.mockReturnValue(null)
    expect(
      expectOk(
        await WhatsAppContactValidationService.availability('u1', 'ws1'),
      ),
    ).toEqual({ available: false, source: null })
  })

  it('propagates database failures and forbids non-members', async () => {
    connectionRepo.listByWorkspace.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await WhatsAppContactValidationService.availability('u1', 'ws1'),
      'DATABASE_ERROR',
    )
    membershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppContactValidationService.availability('u1', 'ws1'),
      'FORBIDDEN',
    )
  })
})

describe('start() on a Meta-only workspace', () => {
  it('creates the run on the platform instance and audits who started it', async () => {
    const ids = Array.from({ length: 201 }, (_, i) => `c${i}`)
    const result = await WhatsAppContactValidationService.start('u1', 'ws1', {
      scope: 'CONTACTS',
      contactIds: ids,
    })
    expect(expectOk(result).status).toBe('QUEUED')
    expect(runRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: 'platform',
        requestedById: 'u1',
      }),
    )
    expect(add).toHaveBeenCalled()
  })
})

describe('execute() on the platform instance', () => {
  function setup(contacts = [{ id: 'c1', waId: '5511999990001', ...stale }]) {
    runRepo.findByIdRaw.mockResolvedValue(
      ok(run({ contactIds: contacts.map((c) => c.id) })),
    )
    contactRepo.listForWhatsappCheck.mockResolvedValue(ok(contacts))
    contactRepo.applyWhatsappChecks.mockResolvedValue(ok(1))
  }

  it('uses the platform credentials and does not read any connection', async () => {
    setup()
    batch.mockImplementation(async (_c, _p, options) => {
      const results = [
        {
          phone: '5511999990001',
          exists: true,
          outputPhone: '5511999990001',
          lid: null,
        },
      ]
      await options?.onChunk?.({ results, failed: [] })
      return { results, failed: [], invalid: [] }
    })

    const result = await WhatsAppContactValidationService.execute('run1')

    expect(expectOk(result).status).toBe('DONE')
    expect(batch).toHaveBeenCalledWith(
      PLATFORM,
      ['5511999990001'],
      expect.any(Object),
    )
    expect(connectionRepo.findById).not.toHaveBeenCalled()
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('stores only the check result and never rewrites the contact number', async () => {
    setup([{ id: 'c1', waId: '551199990001', ...stale }])
    batch.mockImplementation(async (_c, _p, options) => {
      // WhatsApp knows this Brazilian mobile WITH the ninth digit.
      const results = [
        {
          phone: '551199990001',
          exists: true,
          outputPhone: '5511999990001',
          lid: 'l@lid',
        },
      ]
      await options?.onChunk?.({ results, failed: [] })
      return { results, failed: [], invalid: [] }
    })

    await WhatsAppContactValidationService.execute('run1')

    expect(contactRepo.applyWhatsappChecks).toHaveBeenCalledWith(
      'ws1',
      [{ id: 'c1', hasWhatsapp: true, lid: 'l@lid' }],
      expect.any(Date),
    )
    expect(contactRepo).not.toHaveProperty('updateWaId')
  })

  it('asks the platform budget before each chunk and renews the lease', async () => {
    setup()
    batch.mockImplementation(async (_c, _p, options) => {
      await options?.beforeChunk?.(1)
      return { results: [], failed: [], invalid: [] }
    })
    await WhatsAppContactValidationService.execute('run1')
    expect(renew).toHaveBeenCalled()
    expect(reserveBudget).toHaveBeenCalledWith(1)
  })

  it('does not call Z-API and defers when every platform slot is busy', async () => {
    setup()
    acquireLease.mockResolvedValue(null)
    const result = await WhatsAppContactValidationService.execute('run1')
    expect(expectOk(result).status).toBe('deferred')
    expect(batch).not.toHaveBeenCalled()
    expect(runRepo.markRunning).not.toHaveBeenCalled()
    expect(runRepo.finish).not.toHaveBeenCalled()
  })

  it('hands a busy-instance inline run to the queue', async () => {
    acquireLease.mockResolvedValue(null)
    runRepo.findByIdRaw.mockResolvedValue(ok(run()))
    const result = await WhatsAppContactValidationService.start('u1', 'ws1', {
      scope: 'CONTACTS',
      contactIds: ['c1'],
    })
    expect(expectOk(result).status).toBe('QUEUED')
    expect(add).toHaveBeenCalled()
  })

  it('fails the run when the platform instance was removed meanwhile', async () => {
    setup()
    platformCreds.mockReturnValue(null)
    const result = await WhatsAppContactValidationService.execute('run1')
    expect(expectOk(result).status).toBe('FAILED')
    expect(runRepo.finish).toHaveBeenCalledWith(
      'run1',
      'FAILED',
      expect.any(String),
    )
  })

  it('treats a Z-API outage as not checked, never as "no WhatsApp"', async () => {
    setup()
    batch.mockResolvedValue({
      results: [],
      failed: ['5511999990001'],
      invalid: [],
    })

    const result = await WhatsAppContactValidationService.execute('run1')

    expect(expectOk(result).status).toBe('FAILED')
    expect(contactRepo.applyWhatsappChecks).not.toHaveBeenCalled()
    expect(runRepo.finish).toHaveBeenCalledWith(
      'run1',
      'FAILED',
      expect.stringContaining('Tente novamente'),
    )
  })

  it('leaves the run for the queue retry on an outage before the last attempt', async () => {
    setup()
    batch.mockResolvedValue({
      results: [],
      failed: ['5511999990001'],
      invalid: [],
    })

    const result = await WhatsAppContactValidationService.execute('run1', {
      finalAttempt: false,
    })

    expect(expectOk(result).status).toBe('retry')
    expect(runRepo.finish).not.toHaveBeenCalled()
  })

  it('restarts a retried run from zero counters', async () => {
    runRepo.findByIdRaw.mockResolvedValue(ok(run({ status: 'RUNNING' })))
    contactRepo.listForWhatsappCheck.mockResolvedValue(ok([]))
    await WhatsAppContactValidationService.execute('run1')
    expect(runRepo.resetProgress).toHaveBeenCalledWith('run1')
  })

  it('serves contacts checked inside the TTL from the cache (not asked again)', async () => {
    runRepo.findByIdRaw.mockResolvedValue(ok(run({ contactIds: ['c1'] })))
    contactRepo.listForWhatsappCheck.mockResolvedValue(
      ok([
        {
          id: 'c1',
          waId: '5511999990001',
          hasWhatsapp: false,
          whatsappCheckedAt: new Date(),
        },
      ]),
    )
    await WhatsAppContactValidationService.execute('run1')
    expect(batch).toHaveBeenCalledWith(PLATFORM, [], expect.any(Object))
    expect(runRepo.addProgress).toHaveBeenCalledWith(
      'run1',
      expect.objectContaining({ cached: 1 }),
    )
  })
})
