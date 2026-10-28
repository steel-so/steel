import type { Role, WorkspaceSendingDomain } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  verify: vi.fn(),
  get: vi.fn(),
  remove: vi.fn(),
  dmarc: vi.fn(),
  emit: vi.fn(),
  admins: vi.fn(),
}))

vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/sending-domain.repository')
vi.mock('@/src/lib/sending-domain/resend-domains', () => ({
  ResendDomains: {
    create: mocks.create,
    verify: mocks.verify,
    get: mocks.get,
    remove: mocks.remove,
  },
}))
vi.mock('@/src/lib/sending-domain/dmarc', () => ({ lookupDmarc: mocks.dmarc }))
vi.mock('../notification-emitter', () => ({
  emitNotification: mocks.emit,
  workspaceAdminIds: mocks.admins,
}))

import { auditMutation } from '@/lib/axiom/audit'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import {
  createFakeSendingDomain,
  fakeSendingDomainRecords,
} from '@/src/__tests__/factories/newsletter-nl-domains.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import {
  databaseError,
  sendingDomainNotFound,
  sendingDomainProviderError,
  sendingDomainTaken,
} from '@/src/errors'
import { err, ok } from '@/src/lib/result'
import type { ProviderDomain } from '@/src/lib/sending-domain/resend-domains'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { SendingDomainRepository } from '@/src/repositories/sending-domain.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import type { SendingDomainStatusValue } from '@/src/schemas/sending-domain.schema'
import {
  countNewslettersUsing,
  nextSendingDomainStatus,
  SENDING_DOMAIN_TICK_LIMIT,
  SendingDomainService,
  sendingDomainFailureReason,
} from '../sending-domain.service'

const memberships = vi.mocked(MembershipRepository)
const repo = vi.mocked(SendingDomainRepository)
const moduleAccess = vi.mocked(WorkspaceModuleAccessRepository)
const audit = vi.mocked(auditMutation)

const ACTOR = 'admin-1'
const WS = 'ws-1'
const NOW = new Date('2026-10-28T18:00:00.000Z')
const DB = databaseError('boom')
const DMARC = {
  name: '_dmarc.acme.com.br',
  found: false,
  value: null,
  suggested: 'v=DMARC1; p=none;',
}

function asRole(role: Role | null) {
  memberships.findByUserAndWorkspace.mockResolvedValue(
    ok(
      role
        ? createFakeMembership({ userId: ACTOR, workspaceId: WS, role })
        : null,
    ),
  )
}

function provider(
  status: SendingDomainStatusValue,
  recordStatus = 'pending',
): ProviderDomain {
  return {
    id: 'rd_1',
    status,
    providerStatus: status.toLowerCase(),
    records: fakeSendingDomainRecords(recordStatus),
  }
}

const domain = (overrides?: Partial<WorkspaceSendingDomain>) =>
  createFakeSendingDomain({
    id: 'd1',
    workspaceId: WS,
    resendDomainId: 'rd_1',
    ...overrides,
  })

beforeEach(() => {
  asRole('ADMIN')
  repo.listByWorkspace.mockResolvedValue(ok([domain()]))
  repo.listActiveNewsletterSenders.mockResolvedValue(ok([]))
  repo.findById.mockResolvedValue(ok(domain()))
  repo.findByName.mockResolvedValue(ok(null))
  repo.create.mockImplementation(async (data) =>
    ok(
      createFakeSendingDomain({
        ...data,
        id: 'd-new',
        records: data.records as never,
      }),
    ),
  )
  repo.updateCheck.mockImplementation(async (id, data) =>
    ok(domain({ ...data, id, records: (data.records ?? []) as never })),
  )
  repo.delete.mockResolvedValue(ok(undefined))
  repo.listDueForCheck.mockResolvedValue(ok([]))
  mocks.create.mockResolvedValue(ok(provider('NOT_STARTED', 'not_started')))
  mocks.verify.mockResolvedValue(ok(undefined))
  mocks.get.mockResolvedValue(ok(provider('PENDING')))
  mocks.remove.mockResolvedValue(ok(undefined))
  mocks.dmarc.mockResolvedValue(DMARC)
  mocks.emit.mockResolvedValue(1)
  mocks.admins.mockResolvedValue(['owner-1', ACTOR])
})

describe('pure rules', () => {
  it('keeps VERIFIED while Resend re-checks, follows failures', () => {
    expect(nextSendingDomainStatus('VERIFIED', 'PENDING')).toBe('VERIFIED')
    expect(nextSendingDomainStatus('VERIFIED', 'NOT_STARTED')).toBe('VERIFIED')
    expect(nextSendingDomainStatus('VERIFIED', 'FAILED')).toBe('FAILED')
    expect(nextSendingDomainStatus('PENDING', 'VERIFIED')).toBe('VERIFIED')
    expect(nextSendingDomainStatus('FAILED', 'PENDING')).toBe('PENDING')
  })

  it('explains failures in pt-BR', () => {
    expect(sendingDomainFailureReason('VERIFIED', [])).toBeNull()
    expect(sendingDomainFailureReason('PENDING', [])).toBeNull()
    expect(sendingDomainFailureReason('TEMPORARY_FAILURE', [])).toContain(
      'não respondeu',
    )
    expect(sendingDomainFailureReason('FAILED', [])).toContain(
      'não encontrou os registros',
    )
    expect(
      sendingDomainFailureReason('FAILED', fakeSendingDomainRecords('failed')),
    ).toBe(
      'Registros não encontrados no DNS: SPF (MX send.news), SPF (TXT send.news), DKIM (TXT resend._domainkey.news).',
    )
  })

  it('counts newsletters linked to the domain or sending from its name', () => {
    expect(
      countNewslettersUsing({ id: 'd1', name: 'news.acme.com' }, [
        { sendingDomainId: 'd1', fromEmail: 'x@other.com' },
        { sendingDomainId: null, fromEmail: 'a@News.Acme.com' },
        { sendingDomainId: null, fromEmail: 'a@acme.com' },
        { sendingDomainId: 'd2', fromEmail: 'b@x.com' },
      ]),
    ).toBe(2)
  })
})

describe('authorization', () => {
  it.each([
    ['MEMBER' as Role, 'FORBIDDEN'],
    ['VIEWER' as Role, 'FORBIDDEN'],
    [null, 'FORBIDDEN'],
  ])('refuses %s', async (role, code) => {
    asRole(role)
    expectErr(await SendingDomainService.list(ACTOR, WS), code as never)
    expectErr(await SendingDomainService.get(ACTOR, WS, 'd1'), code as never)
    expectErr(
      await SendingDomainService.create(ACTOR, WS, {
        name: 'news.acme.com',
        region: 'sa-east-1',
      }),
      code as never,
    )
    expectErr(await SendingDomainService.verify(ACTOR, WS, 'd1'), code as never)
    expectErr(await SendingDomainService.remove(ACTOR, WS, 'd1'), code as never)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('refuses when the CRM module is off', async () => {
    moduleAccess.isEnabled.mockResolvedValueOnce(ok(false))
    expectErr(await SendingDomainService.list(ACTOR, WS), 'MODULE_DISABLED')
  })

  it('lets the OWNER in', async () => {
    asRole('OWNER')
    expectOk(await SendingDomainService.list(ACTOR, WS))
  })
})

describe('list / get', () => {
  it('lists without DMARC and with the newsletter count', async () => {
    repo.listActiveNewsletterSenders.mockResolvedValue(
      ok([{ sendingDomainId: 'd1', fromEmail: 'a@news.acme.com.br' }]),
    )
    const items = expectOk(await SendingDomainService.list(ACTOR, WS))
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ id: 'd1', newslettersCount: 1 })
    expect(items[0].dmarc).toBeUndefined()
    expect(mocks.dmarc).not.toHaveBeenCalled()
  })

  it('propagates list failures', async () => {
    repo.listByWorkspace.mockResolvedValueOnce(err(DB))
    expectErr(await SendingDomainService.list(ACTOR, WS), 'DATABASE_ERROR')
    repo.listActiveNewsletterSenders.mockResolvedValueOnce(err(DB))
    expectErr(await SendingDomainService.list(ACTOR, WS), 'DATABASE_ERROR')
  })

  it('gets the detail with DMARC', async () => {
    const dto = expectOk(await SendingDomainService.get(ACTOR, WS, 'd1'))
    expect(repo.findById).toHaveBeenCalledWith('d1', WS)
    expect(mocks.dmarc).toHaveBeenCalledWith('news.acme.com.br')
    expect(dto.dmarc).toEqual(DMARC)
  })

  it('propagates not found and count failures', async () => {
    repo.findById.mockResolvedValueOnce(err(sendingDomainNotFound()))
    expectErr(
      await SendingDomainService.get(ACTOR, WS, 'x'),
      'SENDING_DOMAIN_NOT_FOUND',
    )
    repo.listActiveNewsletterSenders.mockResolvedValueOnce(err(DB))
    expectErr(await SendingDomainService.get(ACTOR, WS, 'd1'), 'DATABASE_ERROR')
  })
})

describe('create', () => {
  const dto = { name: 'news.acme.com.br', region: 'sa-east-1' as const }

  it('registers at Resend, stores the records and audits', async () => {
    const created = expectOk(
      await SendingDomainService.create(ACTOR, WS, dto, NOW),
    )
    expect(mocks.create).toHaveBeenCalledWith('news.acme.com.br', 'sa-east-1')
    expect(repo.create).toHaveBeenCalledWith({
      workspaceId: WS,
      createdById: ACTOR,
      name: 'news.acme.com.br',
      region: 'sa-east-1',
      resendDomainId: 'rd_1',
      status: 'NOT_STARTED',
      records: fakeSendingDomainRecords('not_started'),
      verifiedAt: null,
      lastCheckedAt: NOW,
    })
    expect(created).toMatchObject({ id: 'd-new', status: 'NOT_STARTED' })
    expect(created.dmarc).toEqual(DMARC)
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'sending_domain',
        action: 'create',
        targetId: 'd-new',
      }),
    )
  })

  it('stamps verifiedAt when Resend already reports it verified', async () => {
    mocks.create.mockResolvedValueOnce(ok(provider('VERIFIED', 'verified')))
    expectOk(await SendingDomainService.create(ACTOR, WS, dto, NOW))
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'VERIFIED', verifiedAt: NOW }),
    )
  })

  it('refuses a bare public suffix', async () => {
    expectErr(
      await SendingDomainService.create(ACTOR, WS, {
        name: 'com.br',
        region: 'sa-east-1',
      }),
      'SENDING_DOMAIN_INVALID',
    )
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('refuses a name already registered anywhere', async () => {
    repo.findByName.mockResolvedValueOnce(ok(domain({ workspaceId: 'other' })))
    expectErr(
      await SendingDomainService.create(ACTOR, WS, dto),
      'SENDING_DOMAIN_TAKEN',
    )
    expect(mocks.create).not.toHaveBeenCalled()
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failure' }),
    )
  })

  it('propagates lookup and provider failures', async () => {
    repo.findByName.mockResolvedValueOnce(err(DB))
    expectErr(
      await SendingDomainService.create(ACTOR, WS, dto),
      'DATABASE_ERROR',
    )
    mocks.create.mockResolvedValueOnce(err(sendingDomainProviderError()))
    expectErr(
      await SendingDomainService.create(ACTOR, WS, dto),
      'SENDING_DOMAIN_PROVIDER_ERROR',
    )
    expect(repo.create).not.toHaveBeenCalled()
  })

  it('removes the provider domain when the row cannot be stored', async () => {
    repo.create.mockResolvedValueOnce(err(sendingDomainTaken()))
    expectErr(
      await SendingDomainService.create(ACTOR, WS, dto),
      'SENDING_DOMAIN_TAKEN',
    )
    expect(mocks.remove).toHaveBeenCalledWith('rd_1')
  })
})

describe('verify', () => {
  it('asks Resend to verify, reads the result and stores it', async () => {
    const dto = expectOk(
      await SendingDomainService.verify(ACTOR, WS, 'd1', NOW),
    )
    expect(mocks.verify).toHaveBeenCalledWith('rd_1')
    expect(mocks.get).toHaveBeenCalledWith('rd_1')
    expect(repo.updateCheck).toHaveBeenCalledWith('d1', {
      status: 'PENDING',
      records: fakeSendingDomainRecords('pending'),
      lastCheckedAt: NOW,
      verifiedAt: null,
      failureReason: null,
    })
    expect(dto.dmarc).toEqual(DMARC)
    expect(mocks.emit).not.toHaveBeenCalled()
  })

  it('notifies the admins (not the actor) when the domain becomes verified', async () => {
    mocks.get.mockResolvedValueOnce(ok(provider('VERIFIED', 'verified')))
    const dto = expectOk(
      await SendingDomainService.verify(ACTOR, WS, 'd1', NOW),
    )
    expect(dto.status).toBe('VERIFIED')
    expect(dto.verifiedAt).toBe(NOW.toISOString())
    expect(mocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WS,
        recipients: ['owner-1', ACTOR],
        actorId: ACTOR,
        kind: 'CRM_SENDING_DOMAIN_VERIFIED',
        path: '/settings/email-domains?domain=d1',
        dedupeKey: 'sending-domain-verified:d1:2026-10-28',
      }),
    )
  })

  it('keeps a verified domain verified while Resend re-checks', async () => {
    const since = new Date('2026-10-01T00:00:00.000Z')
    repo.findById.mockResolvedValueOnce(
      ok(domain({ status: 'VERIFIED', verifiedAt: since })),
    )
    expectOk(await SendingDomainService.verify(ACTOR, WS, 'd1', NOW))
    expect(repo.updateCheck).toHaveBeenCalledWith(
      'd1',
      expect.objectContaining({ status: 'VERIFIED', verifiedAt: since }),
    )
    expect(mocks.emit).not.toHaveBeenCalled()
  })

  it('stores the failure reason when the records are missing', async () => {
    mocks.get.mockResolvedValueOnce(ok(provider('FAILED', 'failed')))
    expectOk(await SendingDomainService.verify(ACTOR, WS, 'd1', NOW))
    expect(repo.updateCheck).toHaveBeenCalledWith(
      'd1',
      expect.objectContaining({
        status: 'FAILED',
        failureReason: expect.stringContaining('Registros não encontrados'),
      }),
    )
  })

  it('skips the provider for a domain never registered there', async () => {
    repo.findById.mockResolvedValueOnce(ok(domain({ resendDomainId: null })))
    expectOk(await SendingDomainService.verify(ACTOR, WS, 'd1', NOW))
    expect(mocks.verify).not.toHaveBeenCalled()
    expect(repo.updateCheck).not.toHaveBeenCalled()
  })

  it('propagates failures', async () => {
    repo.findById.mockResolvedValueOnce(err(sendingDomainNotFound()))
    expectErr(
      await SendingDomainService.verify(ACTOR, WS, 'x'),
      'SENDING_DOMAIN_NOT_FOUND',
    )
    mocks.verify.mockResolvedValueOnce(err(sendingDomainProviderError()))
    expectErr(
      await SendingDomainService.verify(ACTOR, WS, 'd1'),
      'SENDING_DOMAIN_PROVIDER_ERROR',
    )
    mocks.get.mockResolvedValueOnce(err(sendingDomainProviderError()))
    expectErr(
      await SendingDomainService.verify(ACTOR, WS, 'd1'),
      'SENDING_DOMAIN_PROVIDER_ERROR',
    )
    repo.updateCheck.mockResolvedValueOnce(err(DB))
    expectErr(
      await SendingDomainService.verify(ACTOR, WS, 'd1'),
      'DATABASE_ERROR',
    )
  })
})

describe('remove', () => {
  it('removes at Resend, deletes the row and audits', async () => {
    expectOk(await SendingDomainService.remove(ACTOR, WS, 'd1'))
    expect(mocks.remove).toHaveBeenCalledWith('rd_1')
    expect(repo.delete).toHaveBeenCalledWith('d1')
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'sending_domain',
        action: 'delete',
        targetId: 'd1',
      }),
    )
  })

  it('refuses while an ACTIVE newsletter sends from it', async () => {
    repo.listActiveNewsletterSenders.mockResolvedValueOnce(
      ok([{ sendingDomainId: null, fromEmail: 'news@news.acme.com.br' }]),
    )
    expectErr(
      await SendingDomainService.remove(ACTOR, WS, 'd1'),
      'SENDING_DOMAIN_IN_USE',
    )
    expect(mocks.remove).not.toHaveBeenCalled()
    expect(repo.delete).not.toHaveBeenCalled()
  })

  it('deletes a row never registered at Resend without calling it', async () => {
    repo.findById.mockResolvedValueOnce(ok(domain({ resendDomainId: null })))
    expectOk(await SendingDomainService.remove(ACTOR, WS, 'd1'))
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it('propagates failures', async () => {
    repo.findById.mockResolvedValueOnce(err(sendingDomainNotFound()))
    expectErr(
      await SendingDomainService.remove(ACTOR, WS, 'x'),
      'SENDING_DOMAIN_NOT_FOUND',
    )
    repo.listActiveNewsletterSenders.mockResolvedValueOnce(err(DB))
    expectErr(
      await SendingDomainService.remove(ACTOR, WS, 'd1'),
      'DATABASE_ERROR',
    )
    mocks.remove.mockResolvedValueOnce(err(sendingDomainProviderError()))
    expectErr(
      await SendingDomainService.remove(ACTOR, WS, 'd1'),
      'SENDING_DOMAIN_PROVIDER_ERROR',
    )
    expect(repo.delete).not.toHaveBeenCalled()
    repo.delete.mockResolvedValueOnce(err(DB))
    expectErr(
      await SendingDomainService.remove(ACTOR, WS, 'd1'),
      'DATABASE_ERROR',
    )
  })
})

describe('runCheckTick', () => {
  it('asks for the due window and the per-tick limit', async () => {
    expect(await SendingDomainService.runCheckTick(NOW)).toEqual({
      checked: 0,
      failed: 0,
      changed: 0,
    })
    expect(repo.listDueForCheck).toHaveBeenCalledWith({
      youngSince: new Date('2026-10-25T18:00:00.000Z'),
      frequentBefore: new Date('2026-10-28T17:51:00.000Z'),
      dailyBefore: new Date('2026-10-27T18:10:00.000Z'),
      limit: SENDING_DOMAIN_TICK_LIMIT,
    })
  })

  it('verifies pending domains, only reads verified ones, and counts changes', async () => {
    repo.listDueForCheck.mockResolvedValueOnce(
      ok([
        domain({ id: 'p1', resendDomainId: 'rd_p1', status: 'PENDING' }),
        domain({ id: 'v1', resendDomainId: 'rd_v1', status: 'VERIFIED' }),
      ]),
    )
    mocks.get
      .mockResolvedValueOnce(ok(provider('VERIFIED', 'verified')))
      .mockResolvedValueOnce(ok(provider('FAILED', 'failed')))

    const result = await SendingDomainService.runCheckTick(NOW, { pauseMs: 1 })
    expect(result).toEqual({ checked: 2, failed: 0, changed: 2 })
    expect(mocks.verify).toHaveBeenCalledTimes(1)
    expect(mocks.verify).toHaveBeenCalledWith('rd_p1')
    expect(mocks.get).toHaveBeenNthCalledWith(1, 'rd_p1')
    expect(mocks.get).toHaveBeenNthCalledWith(2, 'rd_v1')
    expect(mocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'CRM_SENDING_DOMAIN_VERIFIED',
        actorId: null,
      }),
    )
    expect(mocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'CRM_SENDING_DOMAIN_FAILED',
        path: '/settings/email-domains?domain=v1',
        dedupeKey: 'sending-domain-failed:v1:2026-10-28',
      }),
    )
  })

  it('notifies a verified domain that hits a temporary failure', async () => {
    repo.listDueForCheck.mockResolvedValueOnce(
      ok([domain({ status: 'VERIFIED' })]),
    )
    mocks.get.mockResolvedValueOnce(ok(provider('TEMPORARY_FAILURE')))
    await SendingDomainService.runCheckTick(NOW, { pauseMs: 0 })
    expect(mocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'CRM_SENDING_DOMAIN_FAILED' }),
    )
  })

  it('logs and skips a domain whose check fails', async () => {
    repo.listDueForCheck.mockResolvedValueOnce(
      ok([domain({ id: 'a' }), domain({ id: 'b' })]),
    )
    mocks.verify.mockResolvedValueOnce(err(sendingDomainProviderError()))
    const result = await SendingDomainService.runCheckTick(NOW, { pauseMs: 0 })
    expect(result).toEqual({ checked: 1, failed: 1, changed: 0 })
  })

  it('pauses between domains by default', async () => {
    vi.useFakeTimers()
    repo.listDueForCheck.mockResolvedValueOnce(
      ok([domain({ id: 'a' }), domain({ id: 'b' })]),
    )
    const running = SendingDomainService.runCheckTick(NOW)
    await vi.runAllTimersAsync()
    expect(await running).toEqual({ checked: 2, failed: 0, changed: 0 })
    vi.useRealTimers()
  })

  it('returns an empty result when the due list fails', async () => {
    repo.listDueForCheck.mockResolvedValueOnce(err(DB))
    expect(await SendingDomainService.runCheckTick()).toEqual({
      checked: 0,
      failed: 0,
      changed: 0,
    })
  })
})
