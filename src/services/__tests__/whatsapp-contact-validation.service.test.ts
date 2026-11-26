import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeWhatsAppBroadcastList } from '@/src/__tests__/factories/whatsapp-broadcast.factory'
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

const { line, acquireLease, release, renew } = vi.hoisted(() => ({
  line: {
    isAvailable: vi.fn(),
    acquireForValidation: vi.fn(),
    isLineLost: vi.fn(),
  },
  acquireLease: vi.fn(),
  release: vi.fn(async () => {}),
  renew: vi.fn(async () => {}),
}))
vi.mock('../platform-zapi-line.service', () => ({
  PLATFORM_LINE_UNAVAILABLE_MESSAGE:
    'A linha de verificação da plataforma está desconectada; peça a um administrador da plataforma para reconectar.',
  PlatformZapiLineService: line,
}))
vi.mock('@/src/lib/whatsapp/validation-throttle', () => ({
  acquirePlatformLease: acquireLease,
  reservePlatformBudget: vi.fn(async () => true),
}))

const { add } = vi.hoisted(() => ({ add: vi.fn(async () => ({})) }))
vi.mock('@/src/lib/queue/queues', () => ({
  getWhatsappBroadcastQueue: vi.fn(() => ({ add })),
}))

import { checkZapiPhonesBatch } from '@/src/lib/whatsapp/zapi-client'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WhatsAppAiCampaignRepository } from '@/src/repositories/whatsapp-ai-campaign.repository'
import { WhatsAppBroadcastRepository } from '@/src/repositories/whatsapp-broadcast.repository'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import { WhatsAppNumberValidationRepository } from '@/src/repositories/whatsapp-number-validation.repository'
import { WhatsAppContactValidationService } from '../whatsapp-contact-validation.service'
import { WhatsAppSettingsService } from '../whatsapp-settings.service'

const membershipRepo = vi.mocked(MembershipRepository)
const contactRepo = vi.mocked(WhatsAppContactRepository)
const broadcastRepo = vi.mocked(WhatsAppBroadcastRepository)
const campaignRepo = vi.mocked(WhatsAppAiCampaignRepository)
const runRepo = vi.mocked(WhatsAppNumberValidationRepository)
const settingsService = vi.mocked(WhatsAppSettingsService)
const batch = vi.mocked(checkZapiPhonesBatch)

const CREDS = {
  instanceId: 'platform-inst',
  token: 'platform-token',
  clientToken: 'platform-client',
}

function run(overrides: Record<string, unknown> = {}) {
  const now = new Date('2026-10-22T12:00:00.000Z')
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
    createdAt: now,
    ...overrides,
  }
}

function asMember(role: 'MEMBER' | 'ADMIN' = 'MEMBER') {
  membershipRepo.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  asMember()
  line.isAvailable.mockResolvedValue(ok(true))
  line.acquireForValidation.mockResolvedValue(ok(CREDS))
  line.isLineLost.mockResolvedValue(false)
  acquireLease.mockResolvedValue({ release, renew })
  batch.mockReset()
  batch.mockResolvedValue({ results: [], failed: [], invalid: [] })
  runRepo.findActive.mockResolvedValue(ok(null))
  contactRepo.deleteWithoutWhatsapp.mockResolvedValue(
    ok({ contactIds: [], conversationIds: [] }),
  )
  runRepo.create.mockImplementation(async (data) =>
    ok(run({ contactIds: data.contactIds, total: data.contactIds.length })),
  )
  runRepo.markRunning.mockResolvedValue(ok(true))
  runRepo.addProgress.mockResolvedValue(ok(undefined))
  runRepo.finish.mockResolvedValue(ok(undefined))
  settingsService.getEffective.mockResolvedValue(
    ok({ whatsappCheckTtlDays: 30 } as never),
  )
})

describe('start() authorization and sources', () => {
  it('refuses a non-member', async () => {
    membershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))
    const result = await WhatsAppContactValidationService.start('u1', 'ws1', {
      scope: 'CONTACTS',
      contactIds: ['c1'],
    })
    expectErr(result, 'FORBIDDEN')
    expect(runRepo.create).not.toHaveBeenCalled()
  })

  it('refuses when the platform line is disconnected and never calls a provider', async () => {
    line.isAvailable.mockResolvedValue(ok(false))
    const result = await WhatsAppContactValidationService.start('u1', 'ws1', {
      scope: 'CONTACTS',
      contactIds: ['c1'],
    })
    const error = expectErr(result, 'WHATSAPP_VALIDATION_UNAVAILABLE')
    expect(error.message).toContain('peça a um administrador da plataforma')
    expect(batch).not.toHaveBeenCalled()
    expect(runRepo.create).not.toHaveBeenCalled()
  })

  it('always runs on the platform line, whatever connection the workspace has', async () => {
    contactRepo.listForWhatsappCheck.mockResolvedValue(ok([]))
    runRepo.findByIdRaw.mockResolvedValue(ok(run()))
    runRepo.findById.mockResolvedValue(ok(run({ status: 'DONE' })))
    await WhatsAppContactValidationService.start('u1', 'ws1', {
      scope: 'CONTACTS',
      contactIds: ['c1'],
      // A legacy client may still send it; it is ignored.
      connectionId: 'conn-z',
    } as never)
    expect(runRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: 'platform' }),
    )
  })

  it('propagates a failure reading the platform line', async () => {
    line.isAvailable.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await WhatsAppContactValidationService.start('u1', 'ws1', {
        scope: 'CONTACTS',
        contactIds: ['c1'],
      }),
      'DATABASE_ERROR',
    )
  })

  it('rejects an empty selection', async () => {
    contactRepo.listIds.mockResolvedValue(ok([]))
    expectErr(
      await WhatsAppContactValidationService.start('u1', 'ws1', {
        scope: 'CONTACTS',
        all: true,
      }),
      'CONFLICT',
    )
  })

  it('rejects a second run while one is active', async () => {
    runRepo.findActive.mockResolvedValue(ok(run({ status: 'RUNNING' })))
    expectErr(
      await WhatsAppContactValidationService.start('u1', 'ws1', {
        scope: 'CONTACTS',
        contactIds: ['c1'],
      }),
      'CONFLICT',
    )
  })

  it('propagates a failure when looking for an active run', async () => {
    runRepo.findActive.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await WhatsAppContactValidationService.start('u1', 'ws1', {
        scope: 'CONTACTS',
        contactIds: ['c1'],
      }),
      'DATABASE_ERROR',
    )
  })

  it('propagates a failure creating the run', async () => {
    runRepo.create.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await WhatsAppContactValidationService.start('u1', 'ws1', {
        scope: 'CONTACTS',
        contactIds: ['c1'],
      }),
      'DATABASE_ERROR',
    )
  })

  it('rejects a set above the cap', async () => {
    const ids = Array.from({ length: 20_001 }, (_, i) => `c${i}`)
    expectErr(
      await WhatsAppContactValidationService.startInternal('u1', 'ws1', {
        scope: 'IMPORT',
        scopeId: null,
        contactIds: ids,
      }),
      'CONFLICT',
    )
  })

  it('resolves "all" contacts of the workspace', async () => {
    contactRepo.listIds.mockResolvedValue(ok(['c1', 'c2']))
    contactRepo.listForWhatsappCheck.mockResolvedValue(ok([]))
    runRepo.findByIdRaw.mockResolvedValue(ok(run()))
    runRepo.findById.mockResolvedValue(ok(run({ status: 'DONE' })))
    expectOk(
      await WhatsAppContactValidationService.start('u1', 'ws1', {
        scope: 'CONTACTS',
        all: true,
      }),
    )
    expect(runRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ contactIds: ['c1', 'c2'], scope: 'CONTACTS' }),
    )
  })

  it('propagates a failure listing every contact', async () => {
    contactRepo.listIds.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await WhatsAppContactValidationService.start('u1', 'ws1', {
        scope: 'CONTACTS',
        all: true,
      }),
      'DATABASE_ERROR',
    )
  })

  it('takes the recipients of a broadcast list of the same workspace', async () => {
    broadcastRepo.findByIdRaw.mockResolvedValue(
      ok(createFakeWhatsAppBroadcastList({ id: 'b1', workspaceId: 'ws1' })),
    )
    broadcastRepo.listRecipientContactIds.mockResolvedValue(ok(['c1']))
    contactRepo.listForWhatsappCheck.mockResolvedValue(ok([]))
    runRepo.findByIdRaw.mockResolvedValue(ok(run()))
    runRepo.findById.mockResolvedValue(ok(run({ status: 'DONE' })))
    expectOk(
      await WhatsAppContactValidationService.start('u1', 'ws1', {
        scope: 'BROADCAST',
        broadcastId: 'b1',
      }),
    )
    expect(runRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'BROADCAST', scopeId: 'b1' }),
    )
  })

  it('does not see a broadcast list of another workspace', async () => {
    broadcastRepo.findByIdRaw.mockResolvedValue(
      ok(createFakeWhatsAppBroadcastList({ id: 'b1', workspaceId: 'other' })),
    )
    expectErr(
      await WhatsAppContactValidationService.start('u1', 'ws1', {
        scope: 'BROADCAST',
        broadcastId: 'b1',
      }),
      'WHATSAPP_BROADCAST_NOT_FOUND',
    )
    broadcastRepo.findByIdRaw.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppContactValidationService.start('u1', 'ws1', {
        scope: 'BROADCAST',
        broadcastId: 'b1',
      }),
      'WHATSAPP_BROADCAST_NOT_FOUND',
    )
  })

  it('propagates broadcast lookup failures', async () => {
    broadcastRepo.findByIdRaw.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await WhatsAppContactValidationService.start('u1', 'ws1', {
        scope: 'BROADCAST',
        broadcastId: 'b1',
      }),
      'DATABASE_ERROR',
    )
    broadcastRepo.findByIdRaw.mockResolvedValue(
      ok(createFakeWhatsAppBroadcastList({ id: 'b1', workspaceId: 'ws1' })),
    )
    broadcastRepo.listRecipientContactIds.mockResolvedValue(
      err(databaseError('x')),
    )
    expectErr(
      await WhatsAppContactValidationService.start('u1', 'ws1', {
        scope: 'BROADCAST',
        broadcastId: 'b1',
      }),
      'DATABASE_ERROR',
    )
  })

  it('takes the contacts of an AI campaign', async () => {
    campaignRepo.findById.mockResolvedValue(ok({ id: 'camp1' } as never))
    campaignRepo.listRecipientContactIds.mockResolvedValue(ok(['c1']))
    contactRepo.listForWhatsappCheck.mockResolvedValue(ok([]))
    runRepo.findByIdRaw.mockResolvedValue(ok(run()))
    runRepo.findById.mockResolvedValue(ok(run({ status: 'DONE' })))
    expectOk(
      await WhatsAppContactValidationService.start('u1', 'ws1', {
        scope: 'AI_CAMPAIGN',
        campaignId: 'camp1',
      }),
    )
    expect(runRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'AI_CAMPAIGN', scopeId: 'camp1' }),
    )
  })

  it('reports a missing AI campaign and propagates failures', async () => {
    campaignRepo.findById.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppContactValidationService.start('u1', 'ws1', {
        scope: 'AI_CAMPAIGN',
        campaignId: 'camp1',
      }),
      'WHATSAPP_AI_CAMPAIGN_NOT_FOUND',
    )
    campaignRepo.findById.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await WhatsAppContactValidationService.start('u1', 'ws1', {
        scope: 'AI_CAMPAIGN',
        campaignId: 'camp1',
      }),
      'DATABASE_ERROR',
    )
    campaignRepo.findById.mockResolvedValue(ok({ id: 'camp1' } as never))
    campaignRepo.listRecipientContactIds.mockResolvedValue(
      err(databaseError('x')),
    )
    expectErr(
      await WhatsAppContactValidationService.start('u1', 'ws1', {
        scope: 'AI_CAMPAIGN',
        campaignId: 'camp1',
      }),
      'DATABASE_ERROR',
    )
  })
})

describe('start() inline vs background', () => {
  it('queues big sets as a background job (retried with backoff) and returns the queued run', async () => {
    const ids = Array.from({ length: 201 }, (_, i) => `c${i}`)
    const result = await WhatsAppContactValidationService.start('u1', 'ws1', {
      scope: 'CONTACTS',
      contactIds: ids,
    })
    expect(expectOk(result).status).toBe('QUEUED')
    expect(add).toHaveBeenCalledWith(
      'validate-whatsapp-numbers',
      { validationId: 'run1' },
      {
        attempts: 5,
        backoff: { type: 'exponential', delay: 30_000 },
        jobId: 'whatsapp-validation-run1',
      },
    )
    expect(batch).not.toHaveBeenCalled()
  })

  it('fails the run when the job cannot be queued', async () => {
    add.mockRejectedValueOnce(new Error('redis down'))
    const ids = Array.from({ length: 201 }, (_, i) => `c${i}`)
    expectErr(
      await WhatsAppContactValidationService.start('u1', 'ws1', {
        scope: 'CONTACTS',
        contactIds: ids,
      }),
      'CONFLICT',
    )
    expect(runRepo.finish).toHaveBeenCalledWith(
      'run1',
      'FAILED',
      expect.any(String),
    )
  })

  it('runs small sets inline and returns the finished run', async () => {
    contactRepo.listForWhatsappCheck.mockResolvedValue(ok([]))
    runRepo.findByIdRaw.mockResolvedValue(ok(run()))
    runRepo.findById.mockResolvedValue(
      ok(run({ status: 'DONE', withWhatsapp: 2 })),
    )
    const result = await WhatsAppContactValidationService.start('u1', 'ws1', {
      scope: 'CONTACTS',
      contactIds: ['c1', 'c2'],
    })
    expect(expectOk(result)).toMatchObject({ status: 'DONE', withWhatsapp: 2 })
    expect(add).not.toHaveBeenCalled()
  })

  it('propagates a failure of the inline run', async () => {
    runRepo.findByIdRaw.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await WhatsAppContactValidationService.start('u1', 'ws1', {
        scope: 'CONTACTS',
        contactIds: ['c1'],
      }),
      'DATABASE_ERROR',
    )
  })

  it('propagates a failure re-reading the inline run', async () => {
    contactRepo.listForWhatsappCheck.mockResolvedValue(ok([]))
    runRepo.findByIdRaw.mockResolvedValue(ok(run()))
    runRepo.findById.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await WhatsAppContactValidationService.start('u1', 'ws1', {
        scope: 'CONTACTS',
        contactIds: ['c1'],
      }),
      'DATABASE_ERROR',
    )
  })
})

describe('get()', () => {
  it('returns the run of the workspace', async () => {
    runRepo.findById.mockResolvedValue(ok(run({ status: 'RUNNING' })))
    expect(
      expectOk(await WhatsAppContactValidationService.get('u1', 'ws1', 'run1'))
        .status,
    ).toBe('RUNNING')
  })

  it('answers not found and forbids non-members', async () => {
    runRepo.findById.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppContactValidationService.get('u1', 'ws1', 'run1'),
      'WHATSAPP_VALIDATION_NOT_FOUND',
    )
    runRepo.findById.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await WhatsAppContactValidationService.get('u1', 'ws1', 'run1'),
      'DATABASE_ERROR',
    )
    membershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppContactValidationService.get('u1', 'ws1', 'run1'),
      'FORBIDDEN',
    )
  })
})

describe('execute()', () => {
  const stale = { hasWhatsapp: null, whatsappCheckedAt: null }

  it('skips unknown and finished runs', async () => {
    runRepo.findByIdRaw.mockResolvedValue(ok(null))
    expect(
      expectOk(await WhatsAppContactValidationService.execute('x')).status,
    ).toBe('skipped')
    runRepo.findByIdRaw.mockResolvedValue(ok(run({ status: 'DONE' })))
    expect(
      expectOk(await WhatsAppContactValidationService.execute('run1')).status,
    ).toBe('skipped')
    expect(runRepo.markRunning).not.toHaveBeenCalled()
  })

  it('propagates database failures', async () => {
    runRepo.findByIdRaw.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await WhatsAppContactValidationService.execute('run1'),
      'DATABASE_ERROR',
    )

    runRepo.findByIdRaw.mockResolvedValue(ok(run()))
    runRepo.markRunning.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await WhatsAppContactValidationService.execute('run1'),
      'DATABASE_ERROR',
    )

    line.acquireForValidation.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await WhatsAppContactValidationService.execute('run1'),
      'DATABASE_ERROR',
    )

    contactRepo.listForWhatsappCheck.mockResolvedValue(err(databaseError('x')))
    expectErr(
      await WhatsAppContactValidationService.execute('run1'),
      'DATABASE_ERROR',
    )
  })

  it('fails the run as not checked when the platform line is gone, touching no contact', async () => {
    runRepo.findByIdRaw.mockResolvedValue(ok(run()))
    line.acquireForValidation.mockResolvedValue(
      err(whatsappValidationUnavailable('linha desconectada')),
    )
    expect(
      expectOk(await WhatsAppContactValidationService.execute('run1')).status,
    ).toBe('FAILED')
    expect(batch).not.toHaveBeenCalled()
    expect(contactRepo.applyWhatsappChecks).not.toHaveBeenCalled()
    expect(runRepo.markRunning).not.toHaveBeenCalled()
    expect(runRepo.finish).toHaveBeenCalledWith(
      'run1',
      'FAILED',
      expect.stringContaining('desconectada'),
    )
  })

  it('checks only stale contacts, stores the answers and counts the cached ones', async () => {
    runRepo.findByIdRaw.mockResolvedValue(
      ok(run({ contactIds: ['c1', 'c2', 'c3', 'gone'] })),
    )
    contactRepo.listForWhatsappCheck.mockResolvedValue(
      ok([
        { id: 'c1', waId: '5511999990001', ...stale },
        { id: 'c2', waId: '5511999990002', ...stale },
        {
          id: 'c3',
          waId: '5511999990003',
          hasWhatsapp: true,
          whatsappCheckedAt: new Date(), // fresh: skipped
        },
      ]),
    )
    contactRepo.applyWhatsappChecks.mockResolvedValue(ok(2))
    batch.mockImplementation(async (_credentials, _phones, options) => {
      const results = [
        {
          phone: '5511999990001',
          exists: true,
          outputPhone: null,
          lid: 'l@lid',
        },
        { phone: '5511999990002', exists: false, outputPhone: null, lid: null },
      ]
      await options?.onChunk?.({ results, failed: [] })
      return { results, failed: [], invalid: [] }
    })

    const result = await WhatsAppContactValidationService.execute('run1')

    expect(expectOk(result).status).toBe('DONE')
    expect(batch).toHaveBeenCalledWith(
      CREDS,
      ['5511999990001', '5511999990002'],
      expect.any(Object),
    )
    expect(contactRepo.applyWhatsappChecks).toHaveBeenCalledWith(
      'ws1',
      [
        { id: 'c1', hasWhatsapp: true, lid: 'l@lid' },
        { id: 'c2', hasWhatsapp: false, lid: null },
      ],
      expect.any(Date),
    )
    expect(runRepo.addProgress).toHaveBeenCalledWith('run1', {
      processed: 2, // 1 cached + 1 vanished
      withWhatsapp: 0,
      withoutWhatsapp: 0,
      failed: 0,
      cached: 1,
    })
    expect(runRepo.addProgress).toHaveBeenCalledWith('run1', {
      processed: 2,
      withWhatsapp: 1,
      withoutWhatsapp: 1,
      failed: 0,
      cached: 0,
    })
    expect(runRepo.finish).toHaveBeenCalledWith('run1', 'DONE', null)
    // Only the contact without WhatsApp is removed.
    expect(contactRepo.deleteWithoutWhatsapp).toHaveBeenCalledWith('ws1', [
      'c2',
    ])
  })

  it('re-checks everyone when forced', async () => {
    runRepo.findByIdRaw.mockResolvedValue(
      ok(run({ force: true, contactIds: ['c3'] })),
    )
    contactRepo.listForWhatsappCheck.mockResolvedValue(
      ok([
        {
          id: 'c3',
          waId: '5511999990003',
          hasWhatsapp: true,
          whatsappCheckedAt: new Date(),
        },
      ]),
    )
    batch.mockResolvedValue({ results: [], failed: [], invalid: [] })
    await WhatsAppContactValidationService.execute('run1')
    expect(batch).toHaveBeenCalledWith(
      expect.anything(),
      ['5511999990003'],
      expect.any(Object),
    )
  })

  it('uses the default TTL when the settings cannot be read', async () => {
    settingsService.getEffective.mockResolvedValue(err(databaseError('x')))
    runRepo.findByIdRaw.mockResolvedValue(ok(run({ contactIds: ['c1'] })))
    contactRepo.listForWhatsappCheck.mockResolvedValue(
      ok([
        {
          id: 'c1',
          waId: '5511999990001',
          hasWhatsapp: true,
          whatsappCheckedAt: new Date(),
        },
      ]),
    )
    expect(
      expectOk(await WhatsAppContactValidationService.execute('run1')).status,
    ).toBe('DONE')
    expect(batch).toHaveBeenCalled() // called with no phones
  })

  it('tolerates partial failures and counts invalid numbers as failed', async () => {
    runRepo.findByIdRaw.mockResolvedValue(
      ok(run({ contactIds: ['c1', 'c2', 'c3'] })),
    )
    contactRepo.listForWhatsappCheck.mockResolvedValue(
      ok([
        { id: 'c1', waId: '5511999990001', ...stale },
        { id: 'c2', waId: '5511999990002', ...stale },
        { id: 'c3', waId: 'abc', ...stale },
      ]),
    )
    contactRepo.applyWhatsappChecks.mockResolvedValue(ok(1))
    batch.mockImplementation(async (_c, _p, options) => {
      const results = [
        { phone: '5511999990001', exists: true, outputPhone: null, lid: null },
        { phone: '9999999999999', exists: true, outputPhone: null, lid: null },
      ]
      await options?.onChunk?.({ results, failed: ['5511999990002'] })
      return { results, failed: ['5511999990002'], invalid: ['abc'] }
    })

    const result = await WhatsAppContactValidationService.execute('run1')

    expect(expectOk(result).status).toBe('DONE')
    expect(runRepo.addProgress).toHaveBeenCalledWith('run1', {
      processed: 3,
      withWhatsapp: 1,
      withoutWhatsapp: 0,
      failed: 2, // 1 unanswered + 1 unmatched result
      cached: 0,
    })
    expect(runRepo.addProgress).toHaveBeenCalledWith('run1', {
      processed: 1,
      withWhatsapp: 0,
      withoutWhatsapp: 0,
      failed: 1,
      cached: 0,
    })
  })

  it('does not count answers it failed to save', async () => {
    runRepo.findByIdRaw.mockResolvedValue(ok(run({ contactIds: ['c1', 'c2'] })))
    contactRepo.listForWhatsappCheck.mockResolvedValue(
      ok([
        { id: 'c1', waId: '5511999990001', ...stale },
        { id: 'c2', waId: '5511999990002', ...stale },
      ]),
    )
    contactRepo.applyWhatsappChecks.mockResolvedValue(err(databaseError('x')))
    batch.mockImplementation(async (_c, _p, options) => {
      const results = [
        { phone: '5511999990001', exists: true, outputPhone: null, lid: null },
      ]
      await options?.onChunk?.({ results, failed: ['5511999990002'] })
      return { results, failed: ['5511999990002'], invalid: [] }
    })

    const result = await WhatsAppContactValidationService.execute('run1')

    // Nothing was stored: treated as a provider/storage outage.
    expect(expectOk(result).status).toBe('FAILED')
    expect(runRepo.addProgress).toHaveBeenCalledWith('run1', {
      processed: 2,
      withWhatsapp: 0,
      withoutWhatsapp: 0,
      failed: 2,
      cached: 0,
    })
  })

  it('fails the run when Z-API answers nothing', async () => {
    runRepo.findByIdRaw.mockResolvedValue(ok(run({ contactIds: ['c1'] })))
    contactRepo.listForWhatsappCheck.mockResolvedValue(
      ok([{ id: 'c1', waId: '5511999990001', ...stale }]),
    )
    batch.mockResolvedValue({
      results: [],
      failed: ['5511999990001'],
      invalid: [],
    })

    const result = await WhatsAppContactValidationService.execute('run1')

    expect(expectOk(result).status).toBe('FAILED')
    expect(runRepo.finish).toHaveBeenCalledWith(
      'run1',
      'FAILED',
      expect.stringContaining('Z-API'),
    )
  })

  describe('broadcast list effects', () => {
    function setupBroadcastRun() {
      runRepo.findByIdRaw.mockResolvedValue(
        ok(run({ scope: 'BROADCAST', scopeId: 'b1', contactIds: ['c1'] })),
      )
      contactRepo.listForWhatsappCheck.mockResolvedValue(
        ok([{ id: 'c1', waId: '5511999990001', ...stale }]),
      )
      contactRepo.applyWhatsappChecks.mockResolvedValue(ok(1))
      batch.mockImplementation(async (_c, _p, options) => {
        const results = [
          {
            phone: '5511999990001',
            exists: false,
            outputPhone: null,
            lid: null,
          },
        ]
        await options?.onChunk?.({ results, failed: [] })
        return { results, failed: [], invalid: [] }
      })
    }

    it('marks the recipients without WhatsApp of a DRAFT list that skips them', async () => {
      setupBroadcastRun()
      broadcastRepo.findByIdRaw.mockResolvedValue(
        ok(
          createFakeWhatsAppBroadcastList({
            id: 'b1',
            status: 'DRAFT',
            skipNoWhatsapp: true,
          }),
        ),
      )
      broadcastRepo.skipPendingWithoutWhatsapp.mockResolvedValue(ok(1))
      await WhatsAppContactValidationService.execute('run1')
      expect(broadcastRepo.skipPendingWithoutWhatsapp).toHaveBeenCalledWith(
        'b1',
      )
    })

    it('leaves lists alone when they do not skip, are not DRAFT or are missing', async () => {
      setupBroadcastRun()
      broadcastRepo.findByIdRaw.mockResolvedValueOnce(
        ok(
          createFakeWhatsAppBroadcastList({
            status: 'DRAFT',
            skipNoWhatsapp: false,
          }),
        ),
      )
      await WhatsAppContactValidationService.execute('run1')

      setupBroadcastRun()
      broadcastRepo.findByIdRaw.mockResolvedValueOnce(
        ok(
          createFakeWhatsAppBroadcastList({
            status: 'QUEUED',
            skipNoWhatsapp: true,
          }),
        ),
      )
      await WhatsAppContactValidationService.execute('run1')

      setupBroadcastRun()
      broadcastRepo.findByIdRaw.mockResolvedValueOnce(ok(null))
      await WhatsAppContactValidationService.execute('run1')

      setupBroadcastRun()
      broadcastRepo.findByIdRaw.mockResolvedValueOnce(err(databaseError('x')))
      await WhatsAppContactValidationService.execute('run1')

      expect(broadcastRepo.skipPendingWithoutWhatsapp).not.toHaveBeenCalled()
    })
  })
})

describe('edge cases', () => {
  it('rejects a call with no contact source at all', async () => {
    expectErr(
      await WhatsAppContactValidationService.start('u1', 'ws1', {
        scope: 'CONTACTS',
      }),
      'CONFLICT',
    )
  })

  it('falls back to the created run when the finished one cannot be read', async () => {
    runRepo.findByIdRaw.mockResolvedValue(ok(run({ contactIds: ['c1'] })))
    contactRepo.listForWhatsappCheck.mockResolvedValue(
      ok([
        {
          id: 'c1',
          waId: '5511999990001',
          hasWhatsapp: null,
          whatsappCheckedAt: null,
        },
      ]),
    )
    contactRepo.applyWhatsappChecks.mockResolvedValue(ok(1))
    batch.mockResolvedValue({ results: [], failed: [], invalid: [] })
    runRepo.findById.mockResolvedValue(ok(null))

    const result = await WhatsAppContactValidationService.start('u1', 'ws1', {
      scope: 'CONTACTS',
      contactIds: ['c1'],
    })

    expectOk(result)
    expect(batch).toHaveBeenCalledWith(
      CREDS,
      ['5511999990001'],
      expect.any(Object),
    )
  })

  it('logs a non-Error enqueue failure', async () => {
    add.mockRejectedValueOnce('boom')
    const ids = Array.from({ length: 201 }, (_, i) => `c${i}`)
    expectErr(
      await WhatsAppContactValidationService.start('u1', 'ws1', {
        scope: 'CONTACTS',
        contactIds: ids,
      }),
      'CONFLICT',
    )
  })

  it('finishes even if the final totals cannot be read for the audit', async () => {
    runRepo.findByIdRaw
      .mockResolvedValueOnce(ok(run({ contactIds: [] })))
      .mockResolvedValueOnce(err(databaseError('x')))
    contactRepo.listForWhatsappCheck.mockResolvedValue(ok([]))
    expect(
      expectOk(await WhatsAppContactValidationService.execute('run1')).status,
    ).toBe('DONE')
  })
})
