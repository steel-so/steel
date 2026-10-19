import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeApolloIntegration,
  createFakeCrmApolloImport,
} from '@/src/__tests__/factories/crm-apollo.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import {
  crmApolloForbidden,
  crmApolloImportNotFound,
  crmApolloInvalidKey,
  crmApolloRateLimited,
  crmApolloRequestFailed,
  databaseError,
} from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/lib/integrations/apollo-client', () => ({
  ApolloClient: { bulkMatch: vi.fn() },
}))
vi.mock('@/src/lib/integrations/apollo-webhook', () => ({
  apolloWebhookToken: (id: string) => `tok-${id}`,
  buildApolloWebhookUrl: (token: string) => `https://steel.test/hook/${token}`,
  isApolloPhoneRevealAvailable: vi.fn(),
}))
vi.mock('@/src/lib/queue/queues', () => ({ getCrmApolloImportQueue: vi.fn() }))
vi.mock('@/src/services/sd-integration-credentials')
vi.mock('@/src/services/crm-lead.service', () => ({
  CrmLeadService: { intake: vi.fn() },
}))
vi.mock('@/src/services/crm-notifications', () => ({
  notifyCrmApolloImportDone: vi.fn(),
}))
vi.mock('@/src/repositories/crm-apollo-import.repository')
vi.mock('@/src/repositories/crm-email-opt-out.repository')
vi.mock('@/src/repositories/crm-lead.repository')
vi.mock('@/src/repositories/crm-mailing-list.repository')
vi.mock('@/src/repositories/workspace-integration.repository')

import { ApolloClient } from '@/src/lib/integrations/apollo-client'
import { isApolloPhoneRevealAvailable } from '@/src/lib/integrations/apollo-webhook'
import { getCrmApolloImportQueue } from '@/src/lib/queue/queues'
import { CrmApolloImportRepository } from '@/src/repositories/crm-apollo-import.repository'
import { CrmEmailOptOutRepository } from '@/src/repositories/crm-email-opt-out.repository'
import { CrmLeadRepository } from '@/src/repositories/crm-lead.repository'
import { CrmMailingListMemberRepository } from '@/src/repositories/crm-mailing-list.repository'
import { WorkspaceIntegrationRepository } from '@/src/repositories/workspace-integration.repository'
import { CrmLeadService } from '@/src/services/crm-lead.service'
import { notifyCrmApolloImportDone } from '@/src/services/crm-notifications'
import { decryptSdIntegrationToken } from '@/src/services/sd-integration-credentials'
import { CrmApolloImportRunner } from '../crm-apollo-import-runner.service'

const importRepo = vi.mocked(CrmApolloImportRepository)
const optOutRepo = vi.mocked(CrmEmailOptOutRepository)
const leadRepo = vi.mocked(CrmLeadRepository)
const memberRepo = vi.mocked(CrmMailingListMemberRepository)
const integrationRepo = vi.mocked(WorkspaceIntegrationRepository)
const bulkMatch = vi.mocked(ApolloClient.bulkMatch)
const intake = vi.mocked(CrmLeadService.intake)
const notify = vi.mocked(notifyCrmApolloImportDone)
const add = vi.fn()

function person(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    name: `Pessoa ${id}`,
    firstName: 'P',
    lastName: id,
    email: `${id}@acme.com`,
    emailStatus: 'verified',
    title: 'CTO',
    city: 'Recife',
    state: 'PE',
    country: 'Brazil',
    linkedinUrl: null,
    organizationName: 'Acme',
    organizationDomain: 'acme.com',
    organizationWebsite: null,
    organizationEmployees: null,
    organizationIndustry: null,
    ...over,
  }
}
const RATE = { minuteLeft: 30, hourLeft: 100, dayLeft: 500 }
const matches = (list: unknown[], credits = list.length) =>
  ok({
    data: { matches: list as never, creditsConsumed: credits },
    rateLimit: RATE,
  })

function loadRow(over = {}) {
  const row = createFakeCrmApolloImport({ id: 'imp1', ...over })
  importRepo.findByIdForWorker.mockResolvedValue(ok(row))
  return row
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getCrmApolloImportQueue).mockReturnValue({ add } as never)
  add.mockResolvedValue({})
  importRepo.setStatus.mockImplementation(async (_id, status) =>
    ok(createFakeCrmApolloImport({ id: 'imp1', status, createdCount: 1 })),
  )
  importRepo.addProgress.mockResolvedValue(ok(createFakeCrmApolloImport()))
  optOutRepo.indexByWorkspace.mockResolvedValue(
    ok({ emails: new Set(['out@acme.com']), personIds: new Set() }),
  )
  integrationRepo.findByKind.mockResolvedValue(
    ok(createFakeApolloIntegration()),
  )
  integrationRepo.markError.mockResolvedValue(ok(undefined))
  vi.mocked(decryptSdIntegrationToken).mockResolvedValue(ok('the-key'))
  leadRepo.findExistingExternalIds.mockResolvedValue(ok(new Set(['dup'])))
  memberRepo.addMany.mockResolvedValue(ok(1))
  intake.mockResolvedValue(ok({ lead: {} as never, created: true }))
  vi.mocked(isApolloPhoneRevealAvailable).mockReturnValue(true)
})

describe('CrmApolloImportRunner.run', () => {
  it('enriches in batches, imports quietly and notifies once', async () => {
    const ids = Array.from({ length: 12 }, (_, i) => `a${i}`)
    loadRow({ apolloIds: ids, requestedCount: 12, mailingListId: 'ml1' })
    bulkMatch.mockImplementation(async (_k, batch) =>
      matches(batch.map((id) => person(id))),
    )
    const result = expectOk(await CrmApolloImportRunner.run('imp1'))
    expect(result.state).toBe('DONE')
    expect(bulkMatch).toHaveBeenCalledTimes(2)
    expect(bulkMatch.mock.calls[0][1]).toHaveLength(10)
    expect(intake).toHaveBeenCalledTimes(12)
    const [ws, actor, input, options] = intake.mock.calls[0]
    expect(ws).toBe('ws1')
    expect(actor).toMatchObject({
      kind: 'system',
      via: 'apollo',
      refId: 'imp1',
    })
    expect(input).toMatchObject({ source: 'Apollo', emails: ['a0@acme.com'] })
    expect(input.city).toBe('Recife, PE')
    expect(options).toEqual({
      quiet: true,
      external: { source: 'apollo', id: 'a0' },
    })
    expect(memberRepo.addMany).toHaveBeenCalledTimes(2)
    expect(importRepo.addProgress).toHaveBeenCalledWith(
      'imp1',
      expect.objectContaining({ created: 10, credits: 10, cursor: 10 }),
    )
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('skips opt-outs, bad e-mail status, no e-mail, known ids and unmatched', async () => {
    loadRow({ apolloIds: ['a', 'b', 'c', 'dup', 'e'] })
    bulkMatch.mockResolvedValue(
      matches([
        person('a', { email: 'OUT@acme.com' }),
        person('b', { emailStatus: 'unverified' }),
        person('c', { email: null }),
        person('dup'),
        null,
      ]),
    )
    expectOk(await CrmApolloImportRunner.run('imp1'))
    expect(intake).not.toHaveBeenCalled()
    expect(importRepo.addProgress).toHaveBeenCalledWith(
      'imp1',
      expect.objectContaining({ created: 0, skipped: 5, failed: 0 }),
    )
    // The known lead's address still goes to the destination list.
    expect(memberRepo.addMany).not.toHaveBeenCalled()
  })

  it('counts duplicates found by intake as skipped and failures as failed', async () => {
    loadRow({ apolloIds: ['a', 'b', 'c'], mailingListId: 'ml1' })
    bulkMatch.mockResolvedValue(
      matches([person('a'), person('b'), person('c', { name: '' })]),
    )
    intake
      .mockResolvedValueOnce(ok({ lead: {} as never, created: false }))
      .mockResolvedValueOnce(err(databaseError('x')))
      .mockResolvedValueOnce(ok({ lead: {} as never, created: true }))
    memberRepo.addMany.mockResolvedValue(err(databaseError('x')))
    expectOk(await CrmApolloImportRunner.run('imp1'))
    expect(importRepo.addProgress).toHaveBeenCalledWith(
      'imp1',
      expect.objectContaining({ created: 1, skipped: 1, failed: 1 }),
    )
    expect(intake.mock.calls[2][2].name).toBe('c')
  })

  it('imports saved list contacts without calling the enrichment', async () => {
    loadRow({
      source: 'LIST',
      apolloIds: [],
      contacts: [
        {
          id: 'c1',
          name: 'Ana',
          email: 'ana@acme.com',
          emailStatus: 'verified',
        },
        {
          id: 'c2',
          name: 'Bad',
          email: 'bad@acme.com',
          emailStatus: 'unverified',
        },
        { nope: true },
      ],
    })
    expectOk(await CrmApolloImportRunner.run('imp1'))
    expect(bulkMatch).not.toHaveBeenCalled()
    expect(intake).toHaveBeenCalledTimes(1)
    expect(importRepo.addProgress).toHaveBeenCalledWith(
      'imp1',
      expect.objectContaining({ created: 1, skipped: 1, credits: 0 }),
    )
  })

  it('treats a non-array contacts payload as empty', async () => {
    loadRow({ source: 'LIST', contacts: null })
    expect(expectOk(await CrmApolloImportRunner.run('imp1')).state).toBe('DONE')
  })

  it('pauses on 429 and re-enqueues delayed by retry-after', async () => {
    loadRow({ apolloIds: ['a'] })
    bulkMatch.mockResolvedValue(err(crmApolloRateLimited(30)))
    expect(expectOk(await CrmApolloImportRunner.run('imp1')).state).toBe(
      'PAUSED_RATE_LIMIT',
    )
    expect(add).toHaveBeenCalledWith(
      'run-import',
      { importId: 'imp1' },
      { delay: 30_000 },
    )
    expect(notify).not.toHaveBeenCalled()
  })

  it('falls back to 60 s when Apollo gives no retry-after', async () => {
    loadRow({ apolloIds: ['a'] })
    bulkMatch.mockResolvedValue(err(crmApolloRateLimited()))
    await CrmApolloImportRunner.run('imp1')
    expect(add).toHaveBeenCalledWith(
      'run-import',
      { importId: 'imp1' },
      { delay: 60_000 },
    )
  })

  it('pauses before the next batch when the minute window is empty', async () => {
    loadRow({ apolloIds: Array.from({ length: 11 }, (_, i) => `a${i}`) })
    bulkMatch.mockImplementation(async (_k, batch) =>
      ok({
        data: {
          matches: batch.map((id) => person(id)) as never,
          creditsConsumed: 10,
        },
        rateLimit: { minuteLeft: 0, hourLeft: 5, dayLeft: 5 },
      }),
    )
    expect(expectOk(await CrmApolloImportRunner.run('imp1')).state).toBe(
      'PAUSED_RATE_LIMIT',
    )
    expect(bulkMatch).toHaveBeenCalledTimes(1)
    expect(importRepo.addProgress).toHaveBeenCalledWith(
      'imp1',
      expect.objectContaining({ cursor: 10 }),
    )
  })

  it('resumes from the stored cursor', async () => {
    loadRow({
      apolloIds: ['a', 'b', 'c'],
      cursor: 2,
      status: 'PAUSED_RATE_LIMIT',
    })
    bulkMatch.mockResolvedValue(matches([person('c')]))
    await CrmApolloImportRunner.run('imp1')
    expect(bulkMatch.mock.calls[0][1]).toEqual(['c'])
  })

  it.each([crmApolloInvalidKey(), crmApolloForbidden()])(
    'fails the run and stamps the connection on $code',
    async (error) => {
      loadRow({ apolloIds: ['a'] })
      bulkMatch.mockResolvedValue(err(error))
      expect(expectOk(await CrmApolloImportRunner.run('imp1')).state).toBe(
        'FAILED',
      )
      expect(integrationRepo.markError).toHaveBeenCalled()
      expect(notify).not.toHaveBeenCalled()
    },
  )

  it('counts a failed batch and gives up after three in a row', async () => {
    loadRow({ apolloIds: Array.from({ length: 40 }, (_, i) => `a${i}`) })
    bulkMatch.mockResolvedValue(err(crmApolloRequestFailed()))
    expect(expectOk(await CrmApolloImportRunner.run('imp1')).state).toBe(
      'FAILED',
    )
    expect(bulkMatch).toHaveBeenCalledTimes(3)
    expect(importRepo.addProgress).toHaveBeenCalledWith(
      'imp1',
      expect.objectContaining({ failed: 10 }),
    )
  })

  it('recovers when a batch fails once and then works', async () => {
    loadRow({ apolloIds: Array.from({ length: 11 }, (_, i) => `a${i}`) })
    bulkMatch
      .mockResolvedValueOnce(err(crmApolloRequestFailed()))
      .mockResolvedValueOnce(matches([person('a10')]))
    expect(expectOk(await CrmApolloImportRunner.run('imp1')).state).toBe('DONE')
  })

  it('fails when Apollo was disconnected meanwhile', async () => {
    loadRow()
    integrationRepo.findByKind.mockResolvedValue(ok(null))
    expect(expectOk(await CrmApolloImportRunner.run('imp1')).state).toBe(
      'FAILED',
    )
    integrationRepo.findByKind.mockResolvedValue(
      ok(createFakeApolloIntegration()),
    )
    vi.mocked(decryptSdIntegrationToken).mockResolvedValue(
      err(crmApolloInvalidKey()),
    )
    expect(expectOk(await CrmApolloImportRunner.run('imp1')).state).toBe(
      'FAILED',
    )
  })

  it('ignores finished runs and propagates lookup errors', async () => {
    loadRow({ status: 'DONE' })
    expect(expectOk(await CrmApolloImportRunner.run('imp1')).state).toBe(
      'IGNORED',
    )
    importRepo.findByIdForWorker.mockResolvedValue(
      err(crmApolloImportNotFound()),
    )
    expectErr(
      await CrmApolloImportRunner.run('x'),
      'CRM_APOLLO_IMPORT_NOT_FOUND',
    )
    loadRow()
    importRepo.setStatus.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await CrmApolloImportRunner.run('imp1'), 'DATABASE_ERROR')
    importRepo.setStatus.mockResolvedValue(ok(createFakeCrmApolloImport()))
    optOutRepo.indexByWorkspace.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await CrmApolloImportRunner.run('imp1'), 'DATABASE_ERROR')
    optOutRepo.indexByWorkspace.mockResolvedValue(
      ok({ emails: new Set(), personIds: new Set() }),
    )
    integrationRepo.findByKind.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(await CrmApolloImportRunner.run('imp1'), 'DATABASE_ERROR')
  })

  it('finishes even if the final status write fails', async () => {
    loadRow({ source: 'LIST', contacts: [] })
    importRepo.setStatus
      .mockResolvedValueOnce(ok(createFakeCrmApolloImport()))
      .mockResolvedValueOnce(err(databaseError('x')))
    expect(expectOk(await CrmApolloImportRunner.run('imp1')).state).toBe('DONE')
  })
})

describe('CrmApolloImportRunner.run with revealPhones', () => {
  it('asks for phones on SEARCH and remembers people without e-mail', async () => {
    loadRow({
      revealPhones: true,
      apolloIds: ['a1', 'a2'],
      phoneOnlyPeople: [{ id: 'old', name: 'Antiga' }, { nope: true }],
    })
    bulkMatch.mockResolvedValue(
      matches([
        person('a1'),
        person('a2', { email: null, linkedinUrl: 'https://l/a2' }),
      ]),
    )
    const result = expectOk(await CrmApolloImportRunner.run('imp1'))
    expect(result.state).toBe('DONE')
    expect(bulkMatch).toHaveBeenCalledWith('the-key', ['a1', 'a2'], {
      webhookUrl: 'https://steel.test/hook/tok-imp1',
    })
    expect(intake).toHaveBeenCalledTimes(1)
    const progress = importRepo.addProgress.mock.calls[0][1]
    expect(progress.phonesRequested).toBe(2)
    expect(progress.phoneOnlyPeople).toEqual([
      { id: 'old', name: 'Antiga' },
      expect.objectContaining({ id: 'a2', linkedin: 'https://l/a2' }),
    ])
  })

  it('does not queue a phone-only person that already is a lead', async () => {
    loadRow({ revealPhones: true, apolloIds: ['dup'] })
    bulkMatch.mockResolvedValue(matches([person('dup', { email: null })]))
    expectOk(await CrmApolloImportRunner.run('imp1'))
    expect(importRepo.addProgress.mock.calls[0][1].phoneOnlyPeople).toEqual([])
  })

  it('re-enriches the picked LIST contacts only to reveal phones', async () => {
    loadRow({
      source: 'LIST',
      revealPhones: true,
      apolloIds: [],
      contacts: [
        {
          id: 'c1',
          name: 'Ana',
          email: 'ana@acme.com',
          emailStatus: 'verified',
        },
        { id: 'c2', name: 'Sem email' },
      ],
    })
    bulkMatch.mockResolvedValue(matches([person('c1'), null], 8))
    expectOk(await CrmApolloImportRunner.run('imp1'))
    expect(bulkMatch).toHaveBeenCalledWith('the-key', ['c1', 'c2'], {
      webhookUrl: 'https://steel.test/hook/tok-imp1',
    })
    expect(intake).toHaveBeenCalledTimes(1)
    expect(importRepo.addProgress).toHaveBeenCalledWith(
      'imp1',
      expect.objectContaining({ created: 1, credits: 8, phonesRequested: 1 }),
    )
    const people = importRepo.addProgress.mock.calls[0][1].phoneOnlyPeople
    expect(people).toEqual([expect.objectContaining({ id: 'c2' })])
  })

  it('still imports a LIST batch when only the phone reveal fails', async () => {
    loadRow({
      source: 'LIST',
      revealPhones: true,
      apolloIds: [],
      contacts: [
        {
          id: 'c1',
          name: 'Ana',
          email: 'ana@acme.com',
          emailStatus: 'verified',
        },
      ],
    })
    bulkMatch.mockResolvedValue(err(crmApolloRequestFailed()))
    const result = expectOk(await CrmApolloImportRunner.run('imp1'))
    expect(result.state).toBe('DONE')
    expect(intake).toHaveBeenCalledTimes(1)
  })

  it('skips the reveal when the public URL is not HTTPS', async () => {
    vi.mocked(isApolloPhoneRevealAvailable).mockReturnValue(false)
    loadRow({ revealPhones: true, apolloIds: ['a1'] })
    bulkMatch.mockResolvedValue(matches([person('a1', { email: null })]))
    expectOk(await CrmApolloImportRunner.run('imp1'))
    expect(bulkMatch).toHaveBeenCalledWith('the-key', ['a1'], {
      webhookUrl: undefined,
    })
    expect(importRepo.addProgress.mock.calls[0][1].phoneOnlyPeople).toBe(
      undefined,
    )
  })
})
