import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, whatsappValidationUnavailable } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/lib/search/index-hooks', () => ({
  removeSearchDocument: vi.fn(),
}))
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/whatsapp-contact.repository')
vi.mock('@/src/repositories/whatsapp-broadcast.repository')
vi.mock('@/src/repositories/whatsapp-ai-campaign.repository')
vi.mock('@/src/repositories/whatsapp-number-validation.repository')
vi.mock('../whatsapp-settings.service')
vi.mock('@/src/lib/whatsapp/zapi-client', () => ({
  checkZapiPhonesBatch: vi.fn(),
}))

const { line, acquireLease, reserveBudget, release, renew } = vi.hoisted(
  () => ({
    line: {
      isAvailable: vi.fn(),
      acquireForValidation: vi.fn(),
      isLineLost: vi.fn(),
    },
    acquireLease: vi.fn(),
    reserveBudget: vi.fn(),
    release: vi.fn(async () => {}),
    renew: vi.fn(async () => {}),
  }),
)
vi.mock('../platform-zapi-line.service', () => ({
  PLATFORM_LINE_UNAVAILABLE_MESSAGE:
    'A linha de verificação da plataforma está desconectada; peça a um administrador da plataforma para reconectar.',
  PlatformZapiLineService: line,
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
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import { WhatsAppNumberValidationRepository } from '@/src/repositories/whatsapp-number-validation.repository'
import {
  resolveValidationSource,
  WhatsAppContactValidationService,
} from '../whatsapp-contact-validation.service'
import { WhatsAppSettingsService } from '../whatsapp-settings.service'

const membershipRepo = vi.mocked(MembershipRepository)
const contactRepo = vi.mocked(WhatsAppContactRepository)
const runRepo = vi.mocked(WhatsAppNumberValidationRepository)
const settingsService = vi.mocked(WhatsAppSettingsService)
const batch = vi.mocked(checkZapiPhonesBatch)

const PLATFORM = {
  instanceId: 'platform-inst',
  token: 'platform-token',
  clientToken: 'platform-client',
}
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
  contactRepo.deleteWithoutWhatsapp.mockResolvedValue(
    ok({ contactIds: [], conversationIds: [] }),
  )
  membershipRepo.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role: 'MEMBER' })),
  )
  line.isAvailable.mockResolvedValue(ok(true))
  line.acquireForValidation.mockResolvedValue(ok(PLATFORM))
  line.isLineLost.mockResolvedValue(false)
  acquireLease.mockResolvedValue({ release, renew })
  reserveBudget.mockResolvedValue(true)
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

describe('resolveValidationSource()', () => {
  it('is the platform line, whatever connections the workspace has', async () => {
    expect(expectOk(await resolveValidationSource())).toEqual({
      kind: 'PLATFORM',
      connectionId: 'platform',
    })
  })

  it('errors with the clear message when the line is not connected', async () => {
    line.isAvailable.mockResolvedValue(ok(false))
    const error = expectErr(
      await resolveValidationSource(),
      'WHATSAPP_VALIDATION_UNAVAILABLE',
    )
    expect(error.message).toContain('peça a um administrador da plataforma')
  })

  it('propagates a failure reading the line', async () => {
    line.isAvailable.mockResolvedValue(err(databaseError('x')))
    expectErr(await resolveValidationSource(), 'DATABASE_ERROR')
  })
})

describe('availability()', () => {
  it('reports the platform source and never leaks credentials', async () => {
    const value = expectOk(
      await WhatsAppContactValidationService.availability('u1', 'ws1'),
    )
    expect(value).toEqual({ available: true, source: 'PLATFORM' })
    expect(JSON.stringify(value)).not.toContain('platform-token')
  })

  it('reports unavailable when the line is disconnected or not configured', async () => {
    line.isAvailable.mockResolvedValue(ok(false))
    expect(
      expectOk(
        await WhatsAppContactValidationService.availability('u1', 'ws1'),
      ),
    ).toEqual({ available: false, source: null })
  })

  it('propagates database failures and forbids non-members', async () => {
    line.isAvailable.mockResolvedValue(err(databaseError('x')))
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

describe('start()', () => {
  it('creates the run on the platform line and audits who started it', async () => {
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

  it('refuses when the line is disconnected, creating nothing', async () => {
    line.isAvailable.mockResolvedValue(ok(false))
    expectErr(
      await WhatsAppContactValidationService.start('u1', 'ws1', {
        scope: 'CONTACTS',
        contactIds: ['c1'],
      }),
      'WHATSAPP_VALIDATION_UNAVAILABLE',
    )
    expect(runRepo.create).not.toHaveBeenCalled()
  })
})

describe('execute() on the platform line', () => {
  function setup(contacts = [{ id: 'c1', waId: '5511999990001', ...stale }]) {
    runRepo.findByIdRaw.mockResolvedValue(
      ok(run({ contactIds: contacts.map((c) => c.id) })),
    )
    contactRepo.listForWhatsappCheck.mockResolvedValue(ok(contacts))
    contactRepo.applyWhatsappChecks.mockResolvedValue(ok(1))
  }

  it('uses the platform line credentials', async () => {
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
    expect(line.acquireForValidation).toHaveBeenCalledTimes(1)
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

  it('fails the run as not checked when the line is gone before it starts', async () => {
    setup()
    line.acquireForValidation.mockResolvedValue(
      err(whatsappValidationUnavailable('desconectada')),
    )
    const result = await WhatsAppContactValidationService.execute('run1')
    expect(expectOk(result).status).toBe('FAILED')
    expect(batch).not.toHaveBeenCalled()
    expect(contactRepo.applyWhatsappChecks).not.toHaveBeenCalled()
    expect(runRepo.finish).toHaveBeenCalledWith(
      'run1',
      'FAILED',
      expect.stringContaining('peça a um administrador da plataforma'),
    )
  })

  it('propagates a database failure reading the line (the job retries)', async () => {
    setup()
    line.acquireForValidation.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await WhatsAppContactValidationService.execute('run1'),
      'DATABASE_ERROR',
    )
    expect(runRepo.finish).not.toHaveBeenCalled()
  })

  it('skips the remaining chunks as not checked when the line drops mid-run', async () => {
    setup([
      { id: 'c1', waId: '5511999990001', ...stale },
      { id: 'c2', waId: '5511999990002', ...stale },
    ])
    contactRepo.applyWhatsappChecks.mockResolvedValue(ok(1))
    line.isLineLost.mockResolvedValue(true)
    batch.mockImplementation(async (_c, _p, options) => {
      // Chunk 1 goes out (the line was checked when the run started).
      expect(await options?.beforeChunk?.(1)).toBe(true)
      const first = [
        {
          phone: '5511999990001',
          exists: true,
          outputPhone: null,
          lid: null,
        },
      ]
      await options?.onChunk?.({ results: first, failed: [] })
      // Chunk 2 finds the phone unpaired: skipped, never "no WhatsApp".
      expect(await options?.beforeChunk?.(1)).toBe(false)
      expect(await options?.beforeChunk?.(1)).toBe(false)
      await options?.onChunk?.({ results: [], failed: ['5511999990002'] })
      return { results: first, failed: ['5511999990002'], invalid: [] }
    })

    const result = await WhatsAppContactValidationService.execute('run1')

    expect(expectOk(result).status).toBe('DONE')
    expect(line.isLineLost).toHaveBeenCalledTimes(1)
    expect(reserveBudget).toHaveBeenCalledTimes(1)
    // Only the answered number is written; the skipped one is never marked.
    expect(contactRepo.applyWhatsappChecks).toHaveBeenNthCalledWith(
      1,
      'ws1',
      [{ id: 'c1', hasWhatsapp: true, lid: null }],
      expect.any(Date),
    )
    expect(contactRepo.applyWhatsappChecks).toHaveBeenNthCalledWith(
      2,
      'ws1',
      [],
      expect.any(Date),
    )
    expect(runRepo.addProgress).toHaveBeenCalledWith(
      'run1',
      expect.objectContaining({ failed: 1, withoutWhatsapp: 0 }),
    )
    expect(runRepo.finish).toHaveBeenCalledWith(
      'run1',
      'DONE',
      expect.stringContaining('desconectada durante a validação'),
    )
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('finishes cleanly, without a retry, when the line is lost before any answer', async () => {
    setup()
    line.isLineLost.mockResolvedValue(true)
    batch.mockImplementation(async (_c, _p, options) => {
      await options?.beforeChunk?.(1)
      expect(await options?.beforeChunk?.(1)).toBe(false)
      return { results: [], failed: ['5511999990001'], invalid: [] }
    })

    const result = await WhatsAppContactValidationService.execute('run1', {
      finalAttempt: false,
    })

    expect(expectOk(result).status).toBe('FAILED')
    expect(contactRepo.applyWhatsappChecks).not.toHaveBeenCalled()
    expect(runRepo.finish).toHaveBeenCalledWith(
      'run1',
      'FAILED',
      expect.stringContaining('desconectada durante a validação'),
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
