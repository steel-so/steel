import type { Role } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakePersonSubscriptionRow } from '@/src/__tests__/factories/newsletter2-crm-bridge.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import {
  crmNewsletterArchived,
  crmNewsletterSubscriberExists,
  databaseError,
} from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/audit')
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/crm-newsletter-bridge.repository')
vi.mock('@/src/services/crm-newsletter-bridge.service')
vi.mock('@/src/services/crm-newsletter-subscriber.service')

import { auditMutation } from '@/lib/axiom/audit'
import { CrmNewsletterBridgeRepository } from '@/src/repositories/crm-newsletter-bridge.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { CrmNewsletterBridge } from '../crm-newsletter-bridge.service'
import {
  MEMBER_UNSUBSCRIBE_REASON,
  CrmNewsletterPersonService as Service,
} from '../crm-newsletter-person.service'
import { CrmNewsletterSubscriberService } from '../crm-newsletter-subscriber.service'

const repo = vi.mocked(CrmNewsletterBridgeRepository)
const membershipRepo = vi.mocked(MembershipRepository)
const subscribers = vi.mocked(CrmNewsletterSubscriberService)
const bridge = vi.mocked(CrmNewsletterBridge)
const audit = vi.mocked(auditMutation)

const WS = 'ws1'
const now = new Date('2026-10-28T12:00:00.000Z')
const person = {
  id: 'p1',
  name: 'Ana',
  emails: [' Ana@Empresa.com.br', 'ana@empresa.com.br', 'ana@pessoal.com'],
}

function asRole(role: Role) {
  membershipRepo.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )
}

const active = createFakePersonSubscriptionRow({ id: 's1', newsletterId: 'a' })
const left = createFakePersonSubscriptionRow({
  id: 's2',
  newsletterId: 'b',
  personId: null,
  email: 'ana@pessoal.com',
  status: 'UNSUBSCRIBED',
  unsubscribedAt: now,
  newsletter: { id: 'b', name: 'Eventos', status: 'ACTIVE' },
})
const bounced = createFakePersonSubscriptionRow({
  id: 's3',
  newsletterId: 'c',
  status: 'BOUNCED',
  newsletter: { id: 'c', name: 'Antiga', status: 'ARCHIVED' },
})

beforeEach(() => {
  vi.clearAllMocks()
  asRole('MEMBER')
  repo.findPerson.mockResolvedValue(ok(person))
  repo.listPersonSubscriptions.mockResolvedValue(ok([active, left, bounced]))
  repo.listActiveNewsletters.mockResolvedValue(
    ok([
      { id: 'a', name: 'Novidades' },
      { id: 'b', name: 'Eventos' },
      { id: 'd', name: 'Dicas' },
    ]),
  )
  repo.findSubscription.mockResolvedValue(ok(active))
  repo.unsubscribe.mockResolvedValue(ok(true))
  repo.welcomeStatsBySubscriber.mockResolvedValue(
    ok(
      new Map([
        ['s1', { sent: 2, opened: 1, clicked: 1 }],
        ['s2', { sent: 0, opened: 0, clicked: 0 }],
      ]),
    ),
  )
  subscribers.add.mockResolvedValue(ok({} as never))
})

describe('get', () => {
  it('lists the subscriptions and the newsletters the person can join', async () => {
    const data = expectOk(await Service.get('u1', WS, 'p1'))
    expect(repo.listPersonSubscriptions).toHaveBeenCalledWith(WS, 'p1', [
      'ana@empresa.com.br',
      'ana@pessoal.com',
    ])
    expect(data.emails).toEqual(['ana@empresa.com.br', 'ana@pessoal.com'])
    expect(
      data.subscriptions.map((s) => [
        s.subscriberId,
        s.status,
        s.canUnsubscribe,
        s.newsletterArchived,
      ]),
    ).toEqual([
      ['s1', 'ACTIVE', true, false],
      ['s2', 'UNSUBSCRIBED', false, false],
      ['s3', 'BOUNCED', false, true],
    ])
    // Unsubscribed can rejoin; active and bounced are not offered.
    expect(data.available.map((n) => n.id)).toEqual(['b', 'd'])
    // Welcome series engagement: null when nothing was sent.
    expect(repo.welcomeStatsBySubscriber).toHaveBeenCalledWith([
      's1',
      's2',
      's3',
    ])
    expect(data.subscriptions.map((s) => s.welcome)).toEqual([
      { sent: 2, opened: 1, clicked: 1 },
      null,
      null,
    ])
  })

  it('denies a non-member and a missing person', async () => {
    membershipRepo.findByUserAndWorkspace.mockResolvedValueOnce(ok(null))
    expectErr(await Service.get('u1', WS, 'p1'), 'FORBIDDEN')
    repo.findPerson.mockResolvedValueOnce(ok(null))
    expectErr(await Service.get('u1', WS, 'p1'), 'RESOURCE_NOT_FOUND')
  })

  it('propagates database errors', async () => {
    repo.findPerson.mockResolvedValueOnce(err(databaseError()))
    expectErr(await Service.get('u1', WS, 'p1'), 'DATABASE_ERROR')
    repo.listPersonSubscriptions.mockResolvedValueOnce(err(databaseError()))
    expectErr(await Service.get('u1', WS, 'p1'), 'DATABASE_ERROR')
    repo.listActiveNewsletters.mockResolvedValueOnce(err(databaseError()))
    expectErr(await Service.get('u1', WS, 'p1'), 'DATABASE_ERROR')
    repo.welcomeStatsBySubscriber.mockResolvedValueOnce(err(databaseError()))
    expectErr(await Service.get('u1', WS, 'p1'), 'DATABASE_ERROR')
  })
})

describe('subscribe', () => {
  it('adds the first e-mail through the manual add', async () => {
    expectOk(
      await Service.subscribe(
        'u1',
        WS,
        'p1',
        { newsletterId: 'd', sendConfirmation: false },
        now,
      ),
    )
    expect(subscribers.add).toHaveBeenCalledWith(
      'u1',
      WS,
      'd',
      {
        email: 'ana@empresa.com.br',
        name: 'Ana',
        sendConfirmation: false,
        consentNote: 'Inscrito pela página da pessoa no CRM.',
      },
      now,
    )
  })

  it('accepts another e-mail of the person (any case)', async () => {
    expectOk(
      await Service.subscribe('u1', WS, 'p1', {
        newsletterId: 'd',
        email: 'ANA@pessoal.com',
        sendConfirmation: true,
      }),
    )
    expect(subscribers.add).toHaveBeenCalledWith(
      'u1',
      WS,
      'd',
      expect.objectContaining({
        email: 'ana@pessoal.com',
        sendConfirmation: true,
      }),
      expect.any(Date),
    )
  })

  it('refuses a foreign e-mail or a person without e-mail', async () => {
    expectErr(
      await Service.subscribe('u1', WS, 'p1', {
        newsletterId: 'd',
        email: 'outro@x.com',
        sendConfirmation: false,
      }),
      'VALIDATION_ERROR',
    )
    repo.findPerson.mockResolvedValueOnce(ok({ ...person, emails: [] }))
    expectErr(
      await Service.subscribe('u1', WS, 'p1', {
        newsletterId: 'd',
        sendConfirmation: false,
      }),
      'VALIDATION_ERROR',
    )
    expect(subscribers.add).not.toHaveBeenCalled()
  })

  it('propagates the add errors and denies a VIEWER', async () => {
    subscribers.add.mockResolvedValueOnce(err(crmNewsletterSubscriberExists()))
    expectErr(
      await Service.subscribe('u1', WS, 'p1', {
        newsletterId: 'a',
        sendConfirmation: false,
      }),
      'CRM_NEWSLETTER_SUBSCRIBER_EXISTS',
    )
    subscribers.add.mockResolvedValueOnce(err(crmNewsletterArchived()))
    expectErr(
      await Service.subscribe('u1', WS, 'p1', {
        newsletterId: 'a',
        sendConfirmation: false,
      }),
      'CRM_NEWSLETTER_ARCHIVED',
    )
    asRole('VIEWER')
    expectErr(
      await Service.subscribe('u1', WS, 'p1', {
        newsletterId: 'a',
        sendConfirmation: false,
      }),
      'FORBIDDEN',
    )
  })
})

describe('unsubscribe', () => {
  it('moves the row to UNSUBSCRIBED, audits and tells the bridge', async () => {
    expectOk(await Service.unsubscribe('u1', WS, 'p1', 's1', now))
    expect(repo.findSubscription).toHaveBeenCalledWith(WS, 's1')
    expect(repo.unsubscribe).toHaveBeenCalledWith(
      's1',
      MEMBER_UNSUBSCRIBE_REASON,
      now,
    )
    expect(audit).toHaveBeenCalledWith({
      entity: 'crm_newsletter_subscriber',
      action: 'opt_out',
      actorId: 'u1',
      targetId: 's1',
      meta: {
        workspaceId: WS,
        newsletterId: 'a',
        personId: 'p1',
        source: 'CRM_PERSON',
      },
    })
    expect(bridge.emit).toHaveBeenCalledWith({
      type: 'unsubscribed',
      subscriberId: 's1',
    })
  })

  it('matches a row by the person e-mail when not linked', async () => {
    repo.findSubscription.mockResolvedValueOnce(
      ok({ ...left, status: 'ACTIVE' }),
    )
    expectOk(await Service.unsubscribe('u1', WS, 'p1', 's2'))
    expect(repo.unsubscribe).toHaveBeenCalledWith(
      's2',
      MEMBER_UNSUBSCRIBE_REASON,
      expect.any(Date),
    )
  })

  it('hides rows of other people and missing rows', async () => {
    repo.findSubscription.mockResolvedValueOnce(
      ok({ ...active, personId: 'p2', email: 'bia@x.com' }),
    )
    expectErr(
      await Service.unsubscribe('u1', WS, 'p1', 's1'),
      'CRM_NEWSLETTER_SUBSCRIBER_NOT_FOUND',
    )
    repo.findSubscription.mockResolvedValueOnce(ok(null))
    expectErr(
      await Service.unsubscribe('u1', WS, 'p1', 's1'),
      'CRM_NEWSLETTER_SUBSCRIBER_NOT_FOUND',
    )
    expect(repo.unsubscribe).not.toHaveBeenCalled()
  })

  it('refuses a row that is no longer subscribed', async () => {
    repo.unsubscribe.mockResolvedValueOnce(ok(false))
    expectErr(
      await Service.unsubscribe('u1', WS, 'p1', 's1'),
      'VALIDATION_ERROR',
    )
    expect(audit).not.toHaveBeenCalled()
    expect(bridge.emit).not.toHaveBeenCalled()
  })

  it('propagates failures and denies a VIEWER', async () => {
    repo.findSubscription.mockResolvedValueOnce(err(databaseError()))
    expectErr(await Service.unsubscribe('u1', WS, 'p1', 's1'), 'DATABASE_ERROR')
    repo.unsubscribe.mockResolvedValueOnce(err(databaseError()))
    expectErr(await Service.unsubscribe('u1', WS, 'p1', 's1'), 'DATABASE_ERROR')
    asRole('VIEWER')
    expectErr(await Service.unsubscribe('u1', WS, 'p1', 's1'), 'FORBIDDEN')
  })
})
