import type { Role } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import {
  createFakeSdStatusPage,
  createFakeSdStatusSubscriber,
} from '@/src/__tests__/factories/nov-s2-major-incident.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import {
  databaseError,
  sdStatusPageSlugTaken,
  sdStatusSubscriberNotFound,
} from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/sd-access.repository')
vi.mock('@/src/repositories/sd-status-page.repository')
vi.mock('@/lib/axiom/audit')
vi.mock('@/src/lib/mail/servicedesk/send-sd-status-update', () => ({
  sendSdStatusConfirmEmail: vi.fn(),
}))

import { sendSdStatusConfirmEmail } from '@/src/lib/mail/servicedesk/send-sd-status-update'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { SdAccessRepository } from '@/src/repositories/sd-access.repository'
import { SdStatusPageRepository } from '@/src/repositories/sd-status-page.repository'
import { SdStatusPageService } from '../sd-status-page.service'

const repo = vi.mocked(SdStatusPageRepository)
const WS = 'ws1'
const page = createFakeSdStatusPage({ customerId: 'c1', serviceIds: ['s1'] })
const sub = createFakeSdStatusSubscriber()
const pending = createFakeSdStatusSubscriber({ confirmedAt: null })

function as(who: 'admin' | 'agent' | 'requester') {
  const role: Role = who === 'admin' ? 'ADMIN' : 'MEMBER'
  vi.mocked(MembershipRepository).findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )
  vi.mocked(SdAccessRepository).listDepartmentLinks.mockResolvedValue(
    ok(
      who === 'agent'
        ? [{ departmentId: 'd', parentId: null, isLead: false }]
        : [],
    ),
  )
}

const createInput = {
  name: 'Acme Telefonia',
  serviceIds: ['s1', 's1'],
  published: true,
  allowSubscriptions: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  as('admin')
  repo.list.mockResolvedValue(ok([page]))
  repo.findById.mockResolvedValue(ok(page))
  repo.create.mockResolvedValue(ok(page))
  repo.update.mockResolvedValue(ok(page))
  repo.remove.mockResolvedValue(ok(true))
  repo.counts.mockResolvedValue(
    ok({ subscribers: new Map([['p1', 3]]), active: new Map() }),
  )
  repo.findNames.mockResolvedValue(
    ok({
      services: new Map([['s1', 'Telefonia']]),
      customers: new Map([['c1', 'Acme']]),
    }),
  )
  repo.findWorkspaceName.mockResolvedValue(ok('Stratus'))
  repo.listSubscribers.mockResolvedValue(ok([sub]))
  repo.findSubscriber.mockResolvedValue(ok(null))
  repo.createSubscriber.mockResolvedValue(ok(sub))
  repo.confirmSubscriber.mockResolvedValue(ok(sub))
  repo.removeSubscriber.mockResolvedValue(ok(true))
  repo.findBySlug.mockResolvedValue(ok(page))
  repo.listIncidents.mockResolvedValue(ok([]))
  repo.findSubscriberByToken.mockResolvedValue(ok(sub))
})

describe('SdStatusPageService admin', () => {
  it('lists and gets pages for agents with the counters', async () => {
    as('agent')
    const list = expectOk(await SdStatusPageService.list('u', WS))
    expect(list.items[0]).toMatchObject({
      subscriberCount: 3,
      activeIncidentCount: 0,
      services: [{ id: 's1', name: 'Telefonia' }],
    })
    expect(expectOk(await SdStatusPageService.get('u', WS, 'p1')).id).toBe('p1')
  })

  it('denies requesters and propagates repository errors', async () => {
    as('requester')
    expectErr(await SdStatusPageService.list('u', WS), 'SD_NOT_AGENT')
    expectErr(await SdStatusPageService.get('u', WS, 'p1'), 'SD_NOT_AGENT')
    as('agent')
    repo.list.mockResolvedValue(err(databaseError()))
    expectErr(await SdStatusPageService.list('u', WS), 'DATABASE_ERROR')
    repo.list.mockResolvedValue(ok([page]))
    repo.counts.mockResolvedValue(err(databaseError()))
    expectErr(await SdStatusPageService.list('u', WS), 'DATABASE_ERROR')
    repo.counts.mockResolvedValue(
      ok({ subscribers: new Map(), active: new Map() }),
    )
    repo.findNames.mockResolvedValue(err(databaseError()))
    expectErr(await SdStatusPageService.list('u', WS), 'DATABASE_ERROR')
    expectErr(await SdStatusPageService.get('u', WS, 'p1'), 'DATABASE_ERROR')
    repo.findById.mockResolvedValue(err(databaseError()))
    expectErr(await SdStatusPageService.get('u', WS, 'p1'), 'DATABASE_ERROR')
  })

  it('creates with a generated slug and retries once on a collision', async () => {
    expectOk(await SdStatusPageService.create('admin', WS, createInput))
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceIds: ['s1'],
        slug: expect.stringMatching(/^acme-telefonia-[0-9a-f]{6}$/),
      }),
    )
    repo.create.mockResolvedValueOnce(err(sdStatusPageSlugTaken()))
    expectOk(await SdStatusPageService.create('admin', WS, createInput))
    expect(repo.create).toHaveBeenCalledTimes(3)
    repo.create.mockResolvedValue(err(sdStatusPageSlugTaken()))
    expectErr(
      await SdStatusPageService.create('admin', WS, createInput),
      'SD_STATUS_PAGE_SLUG_TAKEN',
    )
  })

  it('keeps a typed slug as is and surfaces its collision', async () => {
    repo.create.mockResolvedValue(err(sdStatusPageSlugTaken()))
    expectErr(
      await SdStatusPageService.create('admin', WS, {
        ...createInput,
        slug: 'acme',
        customerId: 'c1',
        description: 'd',
      }),
      'SD_STATUS_PAGE_SLUG_TAKEN',
    )
    expect(repo.create).toHaveBeenCalledTimes(1)
  })

  it('restricts the configuration to admins and propagates db errors', async () => {
    as('agent')
    expectErr(
      await SdStatusPageService.create('u', WS, createInput),
      'FORBIDDEN',
    )
    expectErr(
      await SdStatusPageService.update('u', WS, 'p1', { published: false }),
      'FORBIDDEN',
    )
    expectErr(await SdStatusPageService.remove('u', WS, 'p1'), 'FORBIDDEN')
    as('admin')
    repo.create.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdStatusPageService.create('admin', WS, createInput),
      'DATABASE_ERROR',
    )
    repo.create.mockResolvedValue(ok(page))
    repo.findNames.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdStatusPageService.create('admin', WS, createInput),
      'DATABASE_ERROR',
    )
  })

  it('updates (dedupes services) and removes', async () => {
    expectOk(
      await SdStatusPageService.update('admin', WS, 'p1', {
        serviceIds: ['a', 'a'],
      }),
    )
    expect(repo.update).toHaveBeenCalledWith('p1', WS, { serviceIds: ['a'] })
    expectOk(
      await SdStatusPageService.update('admin', WS, 'p1', { published: false }),
    )
    expectOk(await SdStatusPageService.remove('admin', WS, 'p1'))
    repo.update.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdStatusPageService.update('admin', WS, 'p1', { published: true }),
      'DATABASE_ERROR',
    )
    repo.update.mockResolvedValue(ok(page))
    repo.findNames.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdStatusPageService.update('admin', WS, 'p1', { published: true }),
      'DATABASE_ERROR',
    )
    repo.remove.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdStatusPageService.remove('admin', WS, 'p1'),
      'DATABASE_ERROR',
    )
  })
})

describe('SdStatusPageService subscribers (agents)', () => {
  const add = { channel: 'EMAIL' as const, address: 'ana@acme.com.br' }

  it('lists, adds confirmed subscribers and removes', async () => {
    as('agent')
    expect(
      expectOk(await SdStatusPageService.listSubscribers('u', WS, 'p1')).items,
    ).toHaveLength(1)
    expectOk(await SdStatusPageService.addSubscriber('u', WS, 'p1', add))
    expect(repo.createSubscriber).toHaveBeenCalledWith(
      expect.objectContaining({ confirmed: true, addedById: 'u', name: null }),
    )
    expectOk(await SdStatusPageService.removeSubscriber('u', WS, 'p1', 'sub1'))
  })

  it('returns an existing subscriber and confirms a pending one', async () => {
    as('agent')
    repo.findSubscriber.mockResolvedValue(ok(sub))
    expectOk(await SdStatusPageService.addSubscriber('u', WS, 'p1', add))
    expect(repo.confirmSubscriber).not.toHaveBeenCalled()
    repo.findSubscriber.mockResolvedValue(ok(pending))
    expectOk(await SdStatusPageService.addSubscriber('u', WS, 'p1', add))
    expect(repo.confirmSubscriber).toHaveBeenCalledWith('sub1')
    repo.confirmSubscriber.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdStatusPageService.addSubscriber('u', WS, 'p1', add),
      'DATABASE_ERROR',
    )
  })

  it('denies requesters and propagates errors', async () => {
    as('requester')
    expectErr(
      await SdStatusPageService.listSubscribers('u', WS, 'p1'),
      'SD_NOT_AGENT',
    )
    expectErr(
      await SdStatusPageService.addSubscriber('u', WS, 'p1', add),
      'SD_NOT_AGENT',
    )
    expectErr(
      await SdStatusPageService.removeSubscriber('u', WS, 'p1', 's'),
      'SD_NOT_AGENT',
    )
    as('agent')
    repo.findById.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdStatusPageService.listSubscribers('u', WS, 'p1'),
      'DATABASE_ERROR',
    )
    expectErr(
      await SdStatusPageService.addSubscriber('u', WS, 'p1', add),
      'DATABASE_ERROR',
    )
    expectErr(
      await SdStatusPageService.removeSubscriber('u', WS, 'p1', 's'),
      'DATABASE_ERROR',
    )
    repo.findById.mockResolvedValue(ok(page))
    repo.listSubscribers.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdStatusPageService.listSubscribers('u', WS, 'p1'),
      'DATABASE_ERROR',
    )
    repo.findSubscriber.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdStatusPageService.addSubscriber('u', WS, 'p1', add),
      'DATABASE_ERROR',
    )
    repo.findSubscriber.mockResolvedValue(ok(null))
    repo.createSubscriber.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdStatusPageService.addSubscriber('u', WS, 'p1', add),
      'DATABASE_ERROR',
    )
    repo.removeSubscriber.mockResolvedValue(err(sdStatusSubscriberNotFound()))
    expectErr(
      await SdStatusPageService.removeSubscriber('u', WS, 'p1', 's'),
      'SD_STATUS_SUBSCRIBER_NOT_FOUND',
    )
  })
})

describe('SdStatusPageService public', () => {
  it('builds the public page', async () => {
    const out = expectOk(await SdStatusPageService.getPublic('acme-abc123'))
    expect(out).toMatchObject({
      name: 'Acme',
      workspaceName: 'Stratus',
      overall: 'OPERATIONAL',
      services: ['Telefonia'],
    })
    repo.findWorkspaceName.mockResolvedValue(ok(null))
    expect(
      expectOk(await SdStatusPageService.getPublic('x')).workspaceName,
    ).toBe('')
  })

  it('hides unknown and unpublished pages and propagates errors', async () => {
    repo.findBySlug.mockResolvedValue(ok(null))
    expectErr(
      await SdStatusPageService.getPublic('x'),
      'SD_STATUS_PAGE_NOT_FOUND',
    )
    repo.findBySlug.mockResolvedValue(ok({ ...page, published: false }))
    expectErr(
      await SdStatusPageService.getPublic('x'),
      'SD_STATUS_PAGE_NOT_FOUND',
    )
    repo.findBySlug.mockResolvedValue(err(databaseError()))
    expectErr(await SdStatusPageService.getPublic('x'), 'DATABASE_ERROR')
    repo.findBySlug.mockResolvedValue(ok(page))
    repo.listIncidents.mockResolvedValue(err(databaseError()))
    expectErr(await SdStatusPageService.getPublic('x'), 'DATABASE_ERROR')
    repo.listIncidents.mockResolvedValue(ok([]))
    repo.findNames.mockResolvedValue(err(databaseError()))
    expectErr(await SdStatusPageService.getPublic('x'), 'DATABASE_ERROR')
    repo.findNames.mockResolvedValue(
      ok({ services: new Map(), customers: new Map() }),
    )
    repo.findWorkspaceName.mockResolvedValue(err(databaseError()))
    expectErr(await SdStatusPageService.getPublic('x'), 'DATABASE_ERROR')
  })

  it('subscribes by e-mail with a normalized address and the confirmation mail', async () => {
    repo.createSubscriber.mockResolvedValue(ok(pending))
    expectOk(
      await SdStatusPageService.subscribe('acme', {
        email: ' Ana@ACME.com.br ',
        name: 'Ana',
      }),
    )
    expect(repo.createSubscriber).toHaveBeenCalledWith(
      expect.objectContaining({
        address: 'ana@acme.com.br',
        channel: 'EMAIL',
        confirmed: false,
        name: 'Ana',
      }),
    )
    expect(sendSdStatusConfirmEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'ana@acme.com.br',
        confirmUrl: expect.stringContaining(
          '/status-page/acme-abc123/inscricao/',
        ),
      }),
    )
  })

  it('answers the same for a confirmed address and resends to a pending one', async () => {
    repo.findSubscriber.mockResolvedValue(ok(sub))
    expectOk(await SdStatusPageService.subscribe('acme', { email: 'a@x.com' }))
    expect(sendSdStatusConfirmEmail).not.toHaveBeenCalled()
    repo.findSubscriber.mockResolvedValue(ok(pending))
    repo.findWorkspaceName.mockResolvedValue(err(databaseError()))
    vi.mocked(sendSdStatusConfirmEmail).mockRejectedValue(new Error('x'))
    expectOk(await SdStatusPageService.subscribe('acme', { email: 'a@x.com' }))
    expect(repo.createSubscriber).not.toHaveBeenCalled()
    vi.mocked(sendSdStatusConfirmEmail).mockRejectedValue('plain')
    expectOk(await SdStatusPageService.subscribe('acme', { email: 'a@x.com' }))
  })

  it('refuses closed, unknown and failing subscriptions', async () => {
    const input = { email: 'a@x.com' }
    repo.findBySlug.mockResolvedValue(
      ok({ ...page, allowSubscriptions: false }),
    )
    expectErr(
      await SdStatusPageService.subscribe('acme', input),
      'SD_STATUS_SUBSCRIPTIONS_CLOSED',
    )
    repo.findBySlug.mockResolvedValue(ok(null))
    expectErr(
      await SdStatusPageService.subscribe('acme', input),
      'SD_STATUS_PAGE_NOT_FOUND',
    )
    repo.findBySlug.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdStatusPageService.subscribe('acme', input),
      'DATABASE_ERROR',
    )
    repo.findBySlug.mockResolvedValue(ok(page))
    repo.findSubscriber.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdStatusPageService.subscribe('acme', input),
      'DATABASE_ERROR',
    )
    repo.findSubscriber.mockResolvedValue(ok(null))
    repo.createSubscriber.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdStatusPageService.subscribe('acme', input),
      'DATABASE_ERROR',
    )
  })

  it('shows the subscription with a masked address', async () => {
    const out = expectOk(
      await SdStatusPageService.subscription('acme-abc123', sub.token),
    )
    expect(out).toMatchObject({
      pageName: 'Acme',
      addressMasked: 'a***@acme.com.br',
      confirmed: true,
      unsubscribed: false,
    })
  })

  it('confirms and unsubscribes by token', async () => {
    repo.findSubscriberByToken.mockResolvedValue(ok(pending))
    repo.confirmSubscriber.mockResolvedValue(ok(sub))
    expect(
      expectOk(
        await SdStatusPageService.actOnSubscription(
          'acme-abc123',
          't',
          'CONFIRM',
        ),
      ).confirmed,
    ).toBe(true)
    repo.findSubscriberByToken.mockResolvedValue(ok(sub))
    repo.confirmSubscriber.mockClear()
    expectOk(
      await SdStatusPageService.actOnSubscription(
        'acme-abc123',
        't',
        'CONFIRM',
      ),
    )
    expect(repo.confirmSubscriber).not.toHaveBeenCalled()
    const gone = expectOk(
      await SdStatusPageService.actOnSubscription(
        'acme-abc123',
        't',
        'UNSUBSCRIBE',
      ),
    )
    expect(gone.unsubscribed).toBe(true)
    expect(repo.removeSubscriber).toHaveBeenCalledWith('sub1', 'p1')
  })

  it('rejects unknown tokens, other pages and db errors', async () => {
    repo.findSubscriberByToken.mockResolvedValue(ok(null))
    expectErr(
      await SdStatusPageService.subscription('acme-abc123', 't'),
      'SD_STATUS_SUBSCRIBER_NOT_FOUND',
    )
    repo.findSubscriberByToken.mockResolvedValue(ok(sub))
    expectErr(
      await SdStatusPageService.subscription('other-slug', 't'),
      'SD_STATUS_SUBSCRIBER_NOT_FOUND',
    )
    repo.findSubscriberByToken.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdStatusPageService.subscription('acme-abc123', 't'),
      'DATABASE_ERROR',
    )
    repo.findSubscriberByToken.mockResolvedValue(ok(sub))
    repo.findById.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdStatusPageService.actOnSubscription(
        'acme-abc123',
        't',
        'CONFIRM',
      ),
      'DATABASE_ERROR',
    )
    repo.findById.mockResolvedValue(ok(page))
    repo.removeSubscriber.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdStatusPageService.actOnSubscription(
        'acme-abc123',
        't',
        'UNSUBSCRIBE',
      ),
      'DATABASE_ERROR',
    )
    repo.findSubscriberByToken.mockResolvedValue(ok(pending))
    repo.confirmSubscriber.mockResolvedValue(err(databaseError()))
    expectErr(
      await SdStatusPageService.actOnSubscription(
        'acme-abc123',
        't',
        'CONFIRM',
      ),
      'DATABASE_ERROR',
    )
  })
})
