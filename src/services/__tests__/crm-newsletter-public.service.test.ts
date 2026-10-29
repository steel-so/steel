import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeCrmNewsletter,
  createFakeCrmNewsletterSubscriber,
} from '@/src/__tests__/factories/newsletter-nl-core.factory'
import { createFakeWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import {
  crmNewsletterSubscriberExists,
  databaseError,
  notFound,
} from '@/src/errors'
import {
  createConfirmToken,
  createPreferencesToken,
  createUnsubscribeToken,
} from '@/src/lib/newsletter/tokens'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/crm-newsletter.repository')
vi.mock('@/src/repositories/crm-newsletter-subscriber.repository')
vi.mock('@/src/repositories/crm-email-opt-out.repository')
vi.mock('@/src/repositories/workspace.repository')
vi.mock('@/lib/axiom/audit')
vi.mock('@/src/services/crm-newsletter-bridge.service')
vi.mock('../crm-newsletter-confirmation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../crm-newsletter-confirmation')>()),
  sendNewsletterConfirmation: vi.fn(),
}))

import { auditMutation } from '@/lib/axiom/audit'
import { CrmEmailOptOutRepository } from '@/src/repositories/crm-email-opt-out.repository'
import { CrmNewsletterRepository } from '@/src/repositories/crm-newsletter.repository'
import {
  CrmNewsletterSubscriberRepository,
  type CrmNewsletterSubscriberWithNewsletter,
} from '@/src/repositories/crm-newsletter-subscriber.repository'
import { WorkspaceRepository } from '@/src/repositories/workspace.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { CRM_NEWSLETTER_DEFAULT_CONSENT_TEXT } from '@/src/schemas/crm-newsletter.schema'
import { CrmNewsletterBridge } from '../crm-newsletter-bridge.service'
import { sendNewsletterConfirmation } from '../crm-newsletter-confirmation'
import {
  PREFERENCES_CONSENT_TEXT,
  CrmNewsletterPublicService as Service,
} from '../crm-newsletter-public.service'

const newsletterRepo = vi.mocked(CrmNewsletterRepository)
const repo = vi.mocked(CrmNewsletterSubscriberRepository)
const optOutRepo = vi.mocked(CrmEmailOptOutRepository)
const workspaceRepo = vi.mocked(WorkspaceRepository)
const moduleAccess = vi.mocked(WorkspaceModuleAccessRepository)
const sendConfirmation = vi.mocked(sendNewsletterConfirmation)
const audit = vi.mocked(auditMutation)
const bridge = vi.mocked(CrmNewsletterBridge)

const WS = 'ws1'
const now = new Date('2026-10-28T12:00:00.000Z')
const context = { ip: '1.2.3.4', userAgent: 'UA', now }
const workspace = { id: WS, slug: 'acme', name: 'Acme' }
const newsletter = {
  ...createFakeCrmNewsletter({ id: 'nl1', workspaceId: WS, slug: 'novidades' }),
  workspace,
}

function subscriberWith(
  overrides: Parameters<typeof createFakeCrmNewsletterSubscriber>[0] = {},
  newsletterOverrides: Partial<
    CrmNewsletterSubscriberWithNewsletter['newsletter']
  > = {},
): CrmNewsletterSubscriberWithNewsletter {
  return {
    ...createFakeCrmNewsletterSubscriber({
      id: 's1',
      newsletterId: 'nl1',
      workspaceId: WS,
      email: 'ana@x.com',
      ...overrides,
    }),
    newsletter: {
      id: 'nl1',
      name: 'Novidades',
      slug: 'novidades',
      status: 'ACTIVE',
      doubleOptIn: true,
      fromName: 'Acme',
      fromEmail: 'news@acme.com',
      replyTo: null,
      deletedAt: null,
      workspace,
      ...newsletterOverrides,
    },
  }
}

const subscribeDto = {
  workspaceSlug: 'acme',
  newsletterSlug: 'novidades',
  email: 'Ana@X.com',
  consent: true as const,
  source: 'PUBLIC_PAGE' as const,
}

beforeEach(() => {
  vi.clearAllMocks()
  moduleAccess.isEnabled.mockResolvedValue(ok(true))
  newsletterRepo.findBySlugs.mockResolvedValue(ok(newsletter))
  newsletterRepo.findWithWorkspace.mockResolvedValue(ok(newsletter))
  repo.isOptedOut.mockResolvedValue(ok(false))
  repo.findByEmail.mockResolvedValue(ok(null))
  repo.personIdsByEmails.mockResolvedValue(ok(new Map()))
  repo.create.mockImplementation(async (data) =>
    ok(createFakeCrmNewsletterSubscriber({ ...data, id: 'new' })),
  )
  repo.update.mockImplementation(async (id, data) =>
    ok(createFakeCrmNewsletterSubscriber({ ...(data as object), id })),
  )
  repo.updateMany.mockResolvedValue(ok(1))
  sendConfirmation.mockResolvedValue(ok(true))
})

describe('subscribe', () => {
  it('creates a PENDING subscriber with consent evidence and e-mails it', async () => {
    repo.personIdsByEmails.mockResolvedValue(ok(new Map([['ana@x.com', 'p1']])))
    const result = expectOk(
      await Service.subscribe({ ...subscribeDto, sourceRef: 'site1' }, context),
    )
    expect(result).toEqual({ requiresConfirmation: true, status: 'PENDING' })
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'ana@x.com',
        status: 'PENDING',
        personId: 'p1',
        source: 'PUBLIC_PAGE',
        sourceRef: 'site1',
        consentIp: '1.2.3.4',
        consentUserAgent: 'UA',
        consentText: CRM_NEWSLETTER_DEFAULT_CONSENT_TEXT,
        confirmedAt: null,
      }),
    )
    expect(sendConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({ publisherName: 'Acme' }),
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'opt_in', actorId: null }),
    )
    expect(bridge.emit).toHaveBeenCalledWith({
      type: 'subscribed',
      subscriberId: 'new',
    })
  })

  it('activates right away without double opt-in', async () => {
    newsletterRepo.findBySlugs.mockResolvedValue(
      ok({ ...newsletter, doubleOptIn: false }),
    )
    const result = expectOk(
      await Service.subscribe(
        { ...subscribeDto, name: 'Ana' },
        {
          ...context,
          userAgent: null,
        },
      ),
    )
    expect(result).toEqual({ requiresConfirmation: false, status: 'ACTIVE' })
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'ACTIVE',
        confirmedAt: now,
        name: 'Ana',
      }),
    )
    expect(sendConfirmation).not.toHaveBeenCalled()
  })

  it.each([
    ['opted out', () => repo.isOptedOut.mockResolvedValue(ok(true))],
    [
      'active',
      () =>
        repo.findByEmail.mockResolvedValue(
          ok(createFakeCrmNewsletterSubscriber({ status: 'ACTIVE' })),
        ),
    ],
    [
      'bounced',
      () =>
        repo.findByEmail.mockResolvedValue(
          ok(createFakeCrmNewsletterSubscriber({ status: 'BOUNCED' })),
        ),
    ],
    [
      'complained',
      () =>
        repo.findByEmail.mockResolvedValue(
          ok(createFakeCrmNewsletterSubscriber({ status: 'COMPLAINED' })),
        ),
    ],
    [
      'pending, mailed a minute ago',
      () =>
        repo.findByEmail.mockResolvedValue(
          ok(
            createFakeCrmNewsletterSubscriber({
              status: 'PENDING',
              confirmSentAt: new Date(now.getTime() - 60_000),
            }),
          ),
        ),
    ],
  ])('answers the same and changes nothing when %s', async (_n, arrange) => {
    arrange()
    expect(expectOk(await Service.subscribe(subscribeDto, context))).toEqual({
      requiresConfirmation: true,
      status: 'PENDING',
    })
    expect(repo.create).not.toHaveBeenCalled()
    expect(repo.update).not.toHaveBeenCalled()
    expect(sendConfirmation).not.toHaveBeenCalled()
  })

  it('resends to a PENDING address after 10 minutes', async () => {
    repo.findByEmail.mockResolvedValue(
      ok(
        createFakeCrmNewsletterSubscriber({
          status: 'PENDING',
          confirmSentAt: null,
        }),
      ),
    )
    expectOk(await Service.subscribe(subscribeDto, context))
    expect(sendConfirmation).toHaveBeenCalledTimes(1)
    expect(repo.update).not.toHaveBeenCalled()
    sendConfirmation.mockResolvedValueOnce(err(databaseError()))
    expectErr(await Service.subscribe(subscribeDto, context), 'DATABASE_ERROR')
  })

  it('activates a PENDING row once the newsletter dropped double opt-in', async () => {
    newsletterRepo.findBySlugs.mockResolvedValue(
      ok({ ...newsletter, doubleOptIn: false }),
    )
    repo.findByEmail.mockResolvedValue(
      ok(
        createFakeCrmNewsletterSubscriber({
          id: 'p',
          status: 'PENDING',
          personId: 'old',
        }),
      ),
    )
    expectOk(await Service.subscribe(subscribeDto, context))
    expect(repo.update).toHaveBeenCalledWith(
      'p',
      expect.objectContaining({ status: 'ACTIVE', personId: 'old' }),
    )
  })

  it('brings an UNSUBSCRIBED address back to PENDING', async () => {
    repo.findByEmail.mockResolvedValue(
      ok(
        createFakeCrmNewsletterSubscriber({
          id: 'u',
          status: 'UNSUBSCRIBED',
          name: 'Old',
        }),
      ),
    )
    expectOk(await Service.subscribe(subscribeDto, context))
    expect(repo.update).toHaveBeenCalledWith(
      'u',
      expect.objectContaining({
        status: 'PENDING',
        name: 'Old',
        unsubscribedAt: null,
      }),
    )
    expect(sendConfirmation).toHaveBeenCalled()
  })

  it('treats a lost insert race as success', async () => {
    repo.create.mockResolvedValue(err(crmNewsletterSubscriberExists()))
    expectOk(await Service.subscribe(subscribeDto, context))
    expect(sendConfirmation).not.toHaveBeenCalled()
  })

  it.each([[null], [{ ...newsletter, status: 'ARCHIVED' as const }]])(
    '404 for a missing or archived newsletter',
    async (found) => {
      newsletterRepo.findBySlugs.mockResolvedValue(ok(found))
      expectErr(
        await Service.subscribe(subscribeDto, context),
        'CRM_NEWSLETTER_NOT_FOUND',
      )
    },
  )

  it('refuses when the CRM is off', async () => {
    moduleAccess.isEnabled.mockResolvedValue(ok(false))
    expectErr(await Service.subscribe(subscribeDto, context), 'MODULE_DISABLED')
  })

  it.each([
    [
      'newsletter',
      () => newsletterRepo.findBySlugs.mockResolvedValue(err(databaseError())),
    ],
    ['opt-out', () => repo.isOptedOut.mockResolvedValue(err(databaseError()))],
    ['lookup', () => repo.findByEmail.mockResolvedValue(err(databaseError()))],
    [
      'people',
      () => repo.personIdsByEmails.mockResolvedValue(err(databaseError())),
    ],
    ['insert', () => repo.create.mockResolvedValue(err(databaseError()))],
    [
      'confirmation',
      () => sendConfirmation.mockResolvedValue(err(databaseError())),
    ],
  ])('propagates a %s failure', async (_n, arrange) => {
    arrange()
    expectErr(await Service.subscribe(subscribeDto, context), 'DATABASE_ERROR')
  })
})

describe('subscribeFromForm', () => {
  const input = {
    workspaceId: WS,
    newsletterId: 'nl1',
    formId: 'f1',
    email: 'ana@x.com',
    name: 'Ana',
    consentText: 'Quero',
    context,
  }

  it('subscribes with source FORM and the form consent text', async () => {
    expect(expectOk(await Service.subscribeFromForm(input))).toBe(true)
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'FORM',
        sourceRef: 'f1',
        consentText: 'Quero',
      }),
    )
  })

  it.each([
    [null],
    [{ ...newsletter, workspaceId: 'other' }],
    [{ ...newsletter, status: 'ARCHIVED' as const }],
  ])('subscribes nobody when the newsletter is unusable', async (found) => {
    newsletterRepo.findWithWorkspace.mockResolvedValue(ok(found))
    expect(expectOk(await Service.subscribeFromForm(input))).toBe(false)
  })

  it('propagates failures', async () => {
    repo.isOptedOut.mockResolvedValueOnce(err(databaseError()))
    expectErr(await Service.subscribeFromForm(input), 'DATABASE_ERROR')
    newsletterRepo.findWithWorkspace.mockResolvedValueOnce(err(databaseError()))
    expectErr(await Service.subscribeFromForm(input), 'DATABASE_ERROR')
  })
})

describe('confirm', () => {
  const token = createConfirmToken('s1', now)

  it('activates a PENDING subscriber', async () => {
    repo.findWithNewsletter.mockResolvedValue(
      ok(subscriberWith({ status: 'PENDING' })),
    )
    const outcome = expectOk(await Service.confirm(token, now))
    expect(outcome).toMatchObject({
      state: 'confirmed',
      newsletterName: 'Novidades',
      publisherName: 'Acme',
      archiveUrl: expect.stringContaining('/n/acme/novidades'),
      preferencesUrl: expect.stringContaining('/newsletter/preferencias/'),
    })
    expect(repo.update).toHaveBeenCalledWith('s1', {
      status: 'ACTIVE',
      confirmedAt: now,
    })
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'confirm' }),
    )
    expect(bridge.emit).toHaveBeenCalledWith({
      type: 'confirmed',
      subscriberId: 's1',
    })
  })

  it('is idempotent for ACTIVE (also with an expired link)', async () => {
    repo.findWithNewsletter.mockResolvedValue(
      ok(subscriberWith({ status: 'ACTIVE' }, { status: 'ARCHIVED' })),
    )
    const later = new Date(now.getTime() + 8 * 24 * 3600 * 1000)
    const outcome = expectOk(await Service.confirm(token, later))
    expect(outcome).toMatchObject({ state: 'confirmed', archiveUrl: null })
    expect(repo.update).not.toHaveBeenCalled()
  })

  it('offers a new link when expired and still PENDING', async () => {
    repo.findWithNewsletter.mockResolvedValue(
      ok(subscriberWith({ status: 'PENDING' })),
    )
    const later = new Date(now.getTime() + 8 * 24 * 3600 * 1000)
    expect(expectOk(await Service.confirm(token, later))).toEqual({
      state: 'expired',
      newsletterName: 'Novidades',
      publisherName: 'Acme',
    })
  })

  it.each([
    ['a bad token', 'nope', () => {}],
    [
      'a missing subscriber',
      token,
      () => repo.findWithNewsletter.mockResolvedValue(ok(null)),
    ],
    [
      'a deleted newsletter',
      token,
      () =>
        repo.findWithNewsletter.mockResolvedValue(
          ok(subscriberWith({ status: 'PENDING' }, { deletedAt: now })),
        ),
    ],
    [
      'someone who left',
      token,
      () =>
        repo.findWithNewsletter.mockResolvedValue(
          ok(subscriberWith({ status: 'UNSUBSCRIBED' })),
        ),
    ],
  ])('rejects %s', async (_n, value, arrange) => {
    arrange()
    expectErr(await Service.confirm(value, now), 'CRM_NEWSLETTER_TOKEN_INVALID')
  })

  it('rejects a forged expired token', async () => {
    const later = new Date(now.getTime() + 8 * 24 * 3600 * 1000)
    expectErr(
      await Service.confirm(`${token}x`, later),
      'CRM_NEWSLETTER_TOKEN_INVALID',
    )
  })

  it('propagates failures', async () => {
    repo.findWithNewsletter.mockResolvedValueOnce(err(databaseError()))
    expectErr(await Service.confirm(token, now), 'DATABASE_ERROR')
    repo.findWithNewsletter.mockResolvedValueOnce(
      ok(subscriberWith({ status: 'PENDING' })),
    )
    repo.update.mockResolvedValueOnce(err(databaseError()))
    expectErr(await Service.confirm(token, now), 'DATABASE_ERROR')
  })
})

describe('resendConfirmation', () => {
  const token = createConfirmToken('s1', now)
  const later = new Date(now.getTime() + 8 * 24 * 3600 * 1000)

  it('sends a new e-mail with the subscriber workspace', async () => {
    repo.findWithNewsletter.mockResolvedValue(
      ok(subscriberWith({ status: 'PENDING' })),
    )
    expect(expectOk(await Service.resendConfirmation(token, later))).toEqual({
      sent: true,
    })
    expect(sendConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        newsletter: expect.objectContaining({ workspaceId: WS }),
        publisherName: 'Acme',
      }),
    )
  })

  it('does not send twice inside 10 minutes', async () => {
    repo.findWithNewsletter.mockResolvedValue(
      ok(
        subscriberWith({
          status: 'PENDING',
          confirmSentAt: new Date(later.getTime() - 1000),
        }),
      ),
    )
    expect(expectOk(await Service.resendConfirmation(token, later))).toEqual({
      sent: true,
    })
    expect(sendConfirmation).not.toHaveBeenCalled()
  })

  it.each([
    ['bad token', 'x', () => {}],
    [
      'missing',
      token,
      () => repo.findWithNewsletter.mockResolvedValue(ok(null)),
    ],
    [
      'active',
      token,
      () =>
        repo.findWithNewsletter.mockResolvedValue(
          ok(subscriberWith({ status: 'ACTIVE' })),
        ),
    ],
    [
      'deleted',
      token,
      () =>
        repo.findWithNewsletter.mockResolvedValue(
          ok(subscriberWith({ status: 'PENDING' }, { deletedAt: now })),
        ),
    ],
    [
      'archived',
      token,
      () =>
        repo.findWithNewsletter.mockResolvedValue(
          ok(subscriberWith({ status: 'PENDING' }, { status: 'ARCHIVED' })),
        ),
    ],
  ])('rejects %s', async (_n, value, arrange) => {
    arrange()
    expectErr(
      await Service.resendConfirmation(value, later),
      'CRM_NEWSLETTER_TOKEN_INVALID',
    )
  })

  it('propagates failures', async () => {
    repo.findWithNewsletter.mockResolvedValueOnce(err(databaseError()))
    expectErr(await Service.resendConfirmation(token, later), 'DATABASE_ERROR')
    repo.findWithNewsletter.mockResolvedValueOnce(
      ok(subscriberWith({ status: 'PENDING' })),
    )
    sendConfirmation.mockResolvedValueOnce(err(databaseError()))
    expectErr(await Service.resendConfirmation(token, later), 'DATABASE_ERROR')
  })
})

describe('unsubscribe', () => {
  const token = createUnsubscribeToken({
    subscriberId: 's1',
    recipientId: 'r1',
  })

  it('previews without writing', async () => {
    repo.findWithNewsletter.mockResolvedValue(
      ok(subscriberWith({ status: 'PENDING' })),
    )
    expect(expectOk(await Service.unsubscribePreview(token))).toMatchObject({
      email: 'ana@x.com',
      newsletterName: 'Novidades',
      alreadyUnsubscribed: false,
      preferencesUrl: expect.stringContaining('/newsletter/preferencias/'),
    })
    expect(repo.update).not.toHaveBeenCalled()
  })

  it('leaves this newsletter and marks the issue recipient', async () => {
    repo.findWithNewsletter.mockResolvedValue(
      ok(subscriberWith({ status: 'ACTIVE' })),
    )
    repo.markRecipientUnsubscribed.mockResolvedValue(ok(undefined))
    const result = expectOk(
      await Service.unsubscribe(
        token,
        { reason: 'Muito e-mail', oneClick: true },
        now,
      ),
    )
    expect(result).toEqual({
      email: 'ana@x.com',
      newsletterName: 'Novidades',
      alreadyUnsubscribed: false,
    })
    expect(repo.update).toHaveBeenCalledWith('s1', {
      status: 'UNSUBSCRIBED',
      unsubscribedAt: now,
      unsubscribeReason: 'Muito e-mail',
    })
    expect(repo.markRecipientUnsubscribed).toHaveBeenCalledWith('r1', 's1', now)
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'opt_out',
        meta: expect.objectContaining({ source: 'ONE_CLICK' }),
      }),
    )
    expect(bridge.emit).toHaveBeenCalledWith({
      type: 'unsubscribed',
      subscriberId: 's1',
    })
  })

  it('is idempotent and works without a recipient', async () => {
    const plain = createUnsubscribeToken({ subscriberId: 's1' })
    repo.findWithNewsletter.mockResolvedValue(
      ok(subscriberWith({ status: 'UNSUBSCRIBED' })),
    )
    const result = expectOk(
      await Service.unsubscribe(plain, { oneClick: false }, now),
    )
    expect(result.alreadyUnsubscribed).toBe(true)
    expect(repo.update).not.toHaveBeenCalled()
    expect(bridge.emit).not.toHaveBeenCalled()
    expect(repo.markRecipientUnsubscribed).not.toHaveBeenCalled()
  })

  it('records a LINK unsubscribe without reason', async () => {
    const plain = createUnsubscribeToken({ subscriberId: 's1' })
    repo.findWithNewsletter.mockResolvedValue(
      ok(subscriberWith({ status: 'PENDING' })),
    )
    expectOk(await Service.unsubscribe(plain, { oneClick: false }, now))
    expect(repo.update).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ unsubscribeReason: null }),
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({ source: 'LINK', recipientId: null }),
      }),
    )
  })

  it('rejects bad tokens and missing rows', async () => {
    expectErr(
      await Service.unsubscribePreview('bad'),
      'CRM_NEWSLETTER_TOKEN_INVALID',
    )
    repo.findWithNewsletter.mockResolvedValue(ok(null))
    expectErr(
      await Service.unsubscribe(token, { oneClick: false }, now),
      'CRM_NEWSLETTER_TOKEN_INVALID',
    )
  })

  it('propagates failures', async () => {
    repo.findWithNewsletter.mockResolvedValueOnce(err(databaseError()))
    expectErr(await Service.unsubscribePreview(token), 'DATABASE_ERROR')
    repo.findWithNewsletter.mockResolvedValue(
      ok(subscriberWith({ status: 'ACTIVE' })),
    )
    repo.update.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await Service.unsubscribe(token, { oneClick: false }, now),
      'DATABASE_ERROR',
    )
    repo.markRecipientUnsubscribed.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await Service.unsubscribe(token, { oneClick: false }, now),
      'DATABASE_ERROR',
    )
  })
})

describe('preferences', () => {
  const token = createPreferencesToken({ workspaceId: WS, email: 'Ana@X.com' })
  const nlA = createFakeCrmNewsletter({ id: 'a', workspaceId: WS, name: 'A' })
  const nlB = createFakeCrmNewsletter({ id: 'b', workspaceId: WS, name: 'B' })
  const nlC = createFakeCrmNewsletter({ id: 'c', workspaceId: WS, name: 'C' })
  const subs = [
    createFakeCrmNewsletterSubscriber({
      id: 'sa',
      newsletterId: 'a',
      status: 'ACTIVE',
    }),
    createFakeCrmNewsletterSubscriber({
      id: 'sb',
      newsletterId: 'b',
      status: 'UNSUBSCRIBED',
      personId: 'pb',
    }),
    createFakeCrmNewsletterSubscriber({
      id: 'sc',
      newsletterId: 'c',
      status: 'BOUNCED',
    }),
    // Archived newsletter (not listed): only "sair de tudo" touches it.
    createFakeCrmNewsletterSubscriber({
      id: 'sz',
      newsletterId: 'z',
      status: 'ACTIVE',
    }),
  ]

  beforeEach(() => {
    workspaceRepo.findById.mockResolvedValue(
      ok(createFakeWorkspace({ id: WS, name: 'Acme' })),
    )
    newsletterRepo.listActiveByWorkspace.mockResolvedValue(ok([nlA, nlB, nlC]))
    repo.listByWorkspaceEmail.mockResolvedValue(ok(subs))
    repo.deleteWorkspaceOptOut.mockResolvedValue(ok(undefined))
    optOutRepo.upsert.mockResolvedValue(
      ok({ optOut: {} as never, created: true }),
    )
  })

  it('lists the active newsletters with the subscription state', async () => {
    const prefs = expectOk(await Service.getPreferences(token))
    expect(prefs).toMatchObject({
      workspaceName: 'Acme',
      email: 'ana@x.com',
      optedOutOfAll: false,
    })
    expect(prefs.newsletters.map((n) => [n.id, n.subscribed])).toEqual([
      ['a', true],
      ['b', false],
      ['c', false],
    ])
  })

  it('shows nothing subscribed while opted out of all', async () => {
    repo.isOptedOut.mockResolvedValue(ok(true))
    const prefs = expectOk(await Service.getPreferences(token))
    expect(prefs.optedOutOfAll).toBe(true)
    expect(prefs.newsletters.every((n) => !n.subscribed)).toBe(true)
  })

  it('switches newsletters on and off (bounced never comes back)', async () => {
    const created = createFakeCrmNewsletter({ id: 'd', workspaceId: WS })
    newsletterRepo.listActiveByWorkspace.mockResolvedValue(
      ok([nlA, nlB, nlC, created]),
    )
    expectOk(
      await Service.updatePreferences(
        token,
        {
          subscribedNewsletterIds: ['b', 'c', 'd', 'foreign'],
          unsubscribeAll: false,
          reason: 'menos',
        },
        context,
      ),
    )
    expect(repo.updateMany).toHaveBeenCalledWith(['sa'], {
      status: 'UNSUBSCRIBED',
      unsubscribedAt: now,
      unsubscribeReason: 'menos',
    })
    expect(repo.update).toHaveBeenCalledWith(
      'sb',
      expect.objectContaining({
        status: 'ACTIVE',
        personId: 'pb',
        consentText: PREFERENCES_CONSENT_TEXT,
      }),
    )
    expect(repo.update).toHaveBeenCalledTimes(1)
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        newsletterId: 'd',
        email: 'ana@x.com',
        source: 'PUBLIC_PAGE',
        status: 'ACTIVE',
      }),
    )
    expect(repo.deleteWorkspaceOptOut).not.toHaveBeenCalled()
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'update' }),
    )
    expect(bridge.emitMany).toHaveBeenCalledWith('unsubscribed', ['sa'])
    expect(bridge.emitMany).toHaveBeenCalledWith('subscribed', ['sb', 'new'])
  })

  it('lifts a previous "sair de tudo" when something is switched on', async () => {
    repo.isOptedOut.mockResolvedValue(ok(true))
    expectOk(
      await Service.updatePreferences(
        token,
        { subscribedNewsletterIds: ['a'], unsubscribeAll: false },
        context,
      ),
    )
    expect(repo.deleteWorkspaceOptOut).toHaveBeenCalledWith(WS, 'ana@x.com')
    // "a" was already ACTIVE: nothing to write for it.
    expect(repo.update).not.toHaveBeenCalled()
  })

  it('"sair de tudo" leaves every newsletter and writes the opt-out', async () => {
    expectOk(
      await Service.updatePreferences(
        token,
        { subscribedNewsletterIds: ['a'], unsubscribeAll: true },
        context,
      ),
    )
    expect(repo.updateMany).toHaveBeenCalledWith(
      ['sa', 'sz'],
      expect.objectContaining({ unsubscribeReason: null }),
    )
    expect(optOutRepo.upsert).toHaveBeenCalledWith({
      workspaceId: WS,
      email: 'ana@x.com',
      source: 'PREFERENCES',
    })
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'opt_out' }),
    )
  })

  it('saving the same choice writes and audits nothing', async () => {
    expectOk(
      await Service.updatePreferences(
        token,
        { subscribedNewsletterIds: ['a'], unsubscribeAll: false },
        context,
      ),
    )
    expect(repo.updateMany).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
  })

  it('rejects bad tokens and gone workspaces', async () => {
    expectErr(
      await Service.getPreferences('bad'),
      'CRM_NEWSLETTER_TOKEN_INVALID',
    )
    expectErr(
      await Service.updatePreferences(
        'bad',
        { subscribedNewsletterIds: [], unsubscribeAll: false },
        context,
      ),
      'CRM_NEWSLETTER_TOKEN_INVALID',
    )
    workspaceRepo.findById.mockResolvedValue(err(notFound('Workspace')))
    expectErr(
      await Service.getPreferences(token),
      'CRM_NEWSLETTER_TOKEN_INVALID',
    )
  })

  it.each([
    [
      'workspace',
      () => workspaceRepo.findById.mockResolvedValue(err(databaseError())),
    ],
    [
      'newsletters',
      () =>
        newsletterRepo.listActiveByWorkspace.mockResolvedValue(
          err(databaseError()),
        ),
    ],
    [
      'subscriptions',
      () => repo.listByWorkspaceEmail.mockResolvedValue(err(databaseError())),
    ],
    ['opt-out', () => repo.isOptedOut.mockResolvedValue(err(databaseError()))],
  ])('getPreferences propagates a %s failure', async (_n, arrange) => {
    arrange()
    expectErr(await Service.getPreferences(token), 'DATABASE_ERROR')
  })

  it.each([
    [
      'current',
      () => workspaceRepo.findById.mockResolvedValue(err(databaseError())),
      ['b'],
    ],
    [
      'subscriptions',
      () =>
        repo.listByWorkspaceEmail
          .mockResolvedValueOnce(ok(subs))
          .mockResolvedValueOnce(err(databaseError())),
      ['b'],
    ],
    [
      'leave',
      () => repo.updateMany.mockResolvedValue(err(databaseError())),
      [],
    ],
    [
      'lift',
      () => {
        repo.isOptedOut.mockResolvedValue(ok(true))
        repo.deleteWorkspaceOptOut.mockResolvedValue(err(databaseError()))
      },
      ['b'],
    ],
    [
      'people',
      () => repo.personIdsByEmails.mockResolvedValue(err(databaseError())),
      ['b'],
    ],
    [
      'save',
      () => repo.update.mockResolvedValue(err(databaseError())),
      ['a', 'b'],
    ],
  ])('updatePreferences propagates a %s failure', async (_n, arrange, ids) => {
    arrange()
    expectErr(
      await Service.updatePreferences(
        token,
        { subscribedNewsletterIds: ids, unsubscribeAll: false },
        context,
      ),
      'DATABASE_ERROR',
    )
  })

  it('propagates an opt-out write failure', async () => {
    optOutRepo.upsert.mockResolvedValue(err(databaseError()))
    expectErr(
      await Service.updatePreferences(
        token,
        { subscribedNewsletterIds: [], unsubscribeAll: true },
        context,
      ),
      'DATABASE_ERROR',
    )
  })
})
