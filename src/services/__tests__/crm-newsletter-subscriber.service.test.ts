import type { Role } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import {
  createFakeCrmNewsletter,
  createFakeCrmNewsletterSubscriber,
} from '@/src/__tests__/factories/newsletter-nl-core.factory'
import { createFakeWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import {
  crmNewsletterNotFound,
  crmNewsletterSubscriberNotFound,
  databaseError,
} from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/crm-newsletter.repository')
vi.mock('@/src/repositories/crm-newsletter-subscriber.repository')
vi.mock('@/src/repositories/crm-email-opt-out.repository')
vi.mock('@/src/repositories/workspace.repository')
vi.mock('@/lib/axiom/audit')
vi.mock('../crm-newsletter-confirmation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../crm-newsletter-confirmation')>()),
  sendNewsletterConfirmation: vi.fn(),
}))

import { auditMutation } from '@/lib/axiom/audit'
import { CrmEmailOptOutRepository } from '@/src/repositories/crm-email-opt-out.repository'
import { CrmNewsletterRepository } from '@/src/repositories/crm-newsletter.repository'
import { CrmNewsletterSubscriberRepository } from '@/src/repositories/crm-newsletter-subscriber.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WorkspaceRepository } from '@/src/repositories/workspace.repository'
import { sendNewsletterConfirmation } from '../crm-newsletter-confirmation'
import {
  CRM_NEWSLETTER_IMPORT_CONFIRM_MAX_ROWS,
  IMPORT_CONSENT_TEXT,
  MANUAL_CONSENT_TEXT,
  CrmNewsletterSubscriberService as Service,
} from '../crm-newsletter-subscriber.service'

const newsletterRepo = vi.mocked(CrmNewsletterRepository)
const repo = vi.mocked(CrmNewsletterSubscriberRepository)
const optOutRepo = vi.mocked(CrmEmailOptOutRepository)
const membershipRepo = vi.mocked(MembershipRepository)
const workspaceRepo = vi.mocked(WorkspaceRepository)
const sendConfirmation = vi.mocked(sendNewsletterConfirmation)
const audit = vi.mocked(auditMutation)

const WS = 'ws1'
const NL = 'nl1'
const now = new Date('2026-10-28T12:00:00.000Z')
const newsletter = createFakeCrmNewsletter({
  id: NL,
  workspaceId: WS,
  slug: 'novidades',
})

function asRole(role: Role) {
  membershipRepo.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  asRole('OWNER')
  newsletterRepo.findById.mockResolvedValue(ok(newsletter))
  workspaceRepo.findById.mockResolvedValue(
    ok(createFakeWorkspace({ id: WS, name: 'Acme' })),
  )
  repo.isOptedOut.mockResolvedValue(ok(false))
  repo.findByEmail.mockResolvedValue(ok(null))
  repo.personIdsByEmails.mockResolvedValue(ok(new Map()))
  repo.create.mockImplementation(async (data) =>
    ok(createFakeCrmNewsletterSubscriber({ ...data, id: 'new' })),
  )
  repo.update.mockImplementation(async (id, data) =>
    ok(createFakeCrmNewsletterSubscriber({ ...(data as object), id })),
  )
  sendConfirmation.mockResolvedValue(ok(true))
})

describe('list', () => {
  it('returns a page of DTOs', async () => {
    repo.list.mockResolvedValue(
      ok({ items: [createFakeCrmNewsletterSubscriber()], total: 31 }),
    )
    const query = { page: 2, pageSize: 25 }
    const page = expectOk(await Service.list('u1', WS, NL, query))
    expect(page).toMatchObject({ total: 31, page: 2, pageSize: 25 })
    expect(page.items).toHaveLength(1)
    expect(repo.list).toHaveBeenCalledWith(NL, query)
  })

  it('propagates not found, forbidden and db errors', async () => {
    newsletterRepo.findById.mockResolvedValueOnce(err(crmNewsletterNotFound()))
    expectErr(
      await Service.list('u1', WS, NL, { page: 1, pageSize: 25 }),
      'CRM_NEWSLETTER_NOT_FOUND',
    )
    repo.list.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await Service.list('u1', WS, NL, { page: 1, pageSize: 25 }),
      'DATABASE_ERROR',
    )
    membershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(
      await Service.list('u1', WS, NL, { page: 1, pageSize: 25 }),
      'FORBIDDEN',
    )
  })
})

describe('add', () => {
  const dto = { email: ' Ana@Empresa.com.br ', sendConfirmation: false }

  it('creates an ACTIVE subscriber linked to the CRM person', async () => {
    repo.personIdsByEmails.mockResolvedValue(
      ok(new Map([['ana@empresa.com.br', 'p1']])),
    )
    const created = expectOk(
      await Service.add('u1', WS, NL, { ...dto, consentNote: 'Evento X' }, now),
    )
    expect(created.status).toBe('ACTIVE')
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'ana@empresa.com.br',
        personId: 'p1',
        status: 'ACTIVE',
        source: 'MANUAL',
        sourceRef: 'u1',
        confirmedAt: now,
        consentText: `${MANUAL_CONSENT_TEXT} Observação: Evento X`,
      }),
    )
    expect(sendConfirmation).not.toHaveBeenCalled()
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'crm_newsletter_subscriber',
        action: 'create',
      }),
    )
  })

  it('sends the confirmation when asked', async () => {
    const created = expectOk(
      await Service.add(
        'u1',
        WS,
        NL,
        { ...dto, name: 'Ana', sendConfirmation: true },
        now,
      ),
    )
    expect(created.status).toBe('PENDING')
    expect(sendConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({ publisherName: 'Acme', now }),
    )
  })

  it('brings an unsubscribed address back only through confirmation', async () => {
    repo.findByEmail.mockResolvedValue(
      ok(
        createFakeCrmNewsletterSubscriber({
          id: 's1',
          status: 'UNSUBSCRIBED',
          name: 'Old',
        }),
      ),
    )
    expectOk(await Service.add('u1', WS, NL, dto, now))
    expect(repo.update).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({
        status: 'PENDING',
        name: 'Old',
        unsubscribedAt: null,
      }),
    )
    expect(sendConfirmation).toHaveBeenCalled()
  })

  it.each(['ACTIVE', 'PENDING'] as const)(
    'refuses an %s address',
    async (status) => {
      repo.findByEmail.mockResolvedValue(
        ok(createFakeCrmNewsletterSubscriber({ status })),
      )
      expectErr(
        await Service.add('u1', WS, NL, dto, now),
        'CRM_NEWSLETTER_SUBSCRIBER_EXISTS',
      )
    },
  )

  it.each(['BOUNCED', 'COMPLAINED'] as const)(
    'refuses a %s address',
    async (status) => {
      repo.findByEmail.mockResolvedValue(
        ok(createFakeCrmNewsletterSubscriber({ status })),
      )
      expectErr(await Service.add('u1', WS, NL, dto, now), 'VALIDATION_ERROR')
    },
  )

  it('refuses an address in the workspace opt-out', async () => {
    repo.isOptedOut.mockResolvedValue(ok(true))
    expectErr(await Service.add('u1', WS, NL, dto, now), 'VALIDATION_ERROR')
  })

  it('refuses an archived newsletter', async () => {
    newsletterRepo.findById.mockResolvedValue(
      ok(createFakeCrmNewsletter({ ...newsletter, status: 'ARCHIVED' })),
    )
    expectErr(
      await Service.add('u1', WS, NL, dto, now),
      'CRM_NEWSLETTER_ARCHIVED',
    )
  })

  it('denies a VIEWER', async () => {
    asRole('VIEWER')
    expectErr(await Service.add('u1', WS, NL, dto, now), 'FORBIDDEN')
  })

  it.each([
    [
      'newsletter',
      () => newsletterRepo.findById.mockResolvedValue(err(databaseError())),
    ],
    ['opt-out', () => repo.isOptedOut.mockResolvedValue(err(databaseError()))],
    ['lookup', () => repo.findByEmail.mockResolvedValue(err(databaseError()))],
    [
      'people',
      () => repo.personIdsByEmails.mockResolvedValue(err(databaseError())),
    ],
    ['insert', () => repo.create.mockResolvedValue(err(databaseError()))],
  ])('propagates a %s failure', async (_n, arrange) => {
    arrange()
    expectErr(await Service.add('u1', WS, NL, dto, now), 'DATABASE_ERROR')
  })

  it('propagates confirmation failures', async () => {
    workspaceRepo.findById.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await Service.add('u1', WS, NL, { ...dto, sendConfirmation: true }, now),
      'DATABASE_ERROR',
    )
    sendConfirmation.mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await Service.add('u1', WS, NL, { ...dto, sendConfirmation: true }, now),
      'DATABASE_ERROR',
    )
  })
})

describe('import', () => {
  const existing = [
    createFakeCrmNewsletterSubscriber({
      id: 'a',
      email: 'ativo@x.com',
      status: 'ACTIVE',
    }),
    createFakeCrmNewsletterSubscriber({
      id: 'u',
      email: 'saiu@x.com',
      status: 'UNSUBSCRIBED',
    }),
    createFakeCrmNewsletterSubscriber({
      id: 'b',
      email: 'bounce@x.com',
      status: 'BOUNCED',
    }),
    createFakeCrmNewsletterSubscriber({
      id: 'c',
      email: 'spam@x.com',
      status: 'COMPLAINED',
    }),
  ]
  const rows = [
    { email: 'Novo@X.com', name: ' Novo ' },
    { email: 'invalido' },
    { email: 'novo@x.com' },
    { email: 'ativo@x.com' },
    { email: 'saiu@x.com' },
    { email: 'bounce@x.com' },
    { email: 'spam@x.com' },
    { email: 'optout@x.com' },
    { email: 'outro@x.com', name: '' },
  ]

  beforeEach(() => {
    optOutRepo.indexByWorkspace.mockResolvedValue(
      ok({ emails: new Set(['optout@x.com']), personIds: new Set() }),
    )
    repo.findByEmails.mockResolvedValue(ok(existing))
    repo.personIdsByEmails.mockResolvedValue(
      ok(new Map([['novo@x.com', 'p1']])),
    )
    repo.createMany.mockImplementation(async (list) => ok(list.length - 1))
    repo.updateMany.mockResolvedValue(ok(1))
  })

  it('classifies every row and only reactivates through confirmation', async () => {
    const result = expectOk(
      await Service.import(
        'u1',
        WS,
        NL,
        { rows, consentConfirmed: true, sendConfirmation: false },
        now,
      ),
    )
    expect(result.created).toBe(1)
    expect(result.reactivated).toBe(1)
    // ativo@ + the row createMany skipped as a duplicate (race).
    expect(result.unchanged).toBe(2)
    expect(result.rejected.map((r) => [r.row, r.reason])).toEqual([
      [2, 'E-mail inválido'],
      [3, 'Repetido no arquivo'],
      [6, 'E-mail com retorno permanente'],
      [7, 'Marcou a newsletter como spam'],
      [8, 'Pediu para não receber e-mails deste workspace'],
    ])
    const created = repo.createMany.mock.calls[0][0]
    expect(created.map((r) => [r.email, r.name, r.personId, r.status])).toEqual(
      [
        ['novo@x.com', 'Novo', 'p1', 'ACTIVE'],
        ['outro@x.com', null, null, 'ACTIVE'],
      ],
    )
    expect(created[0]).toMatchObject({
      source: 'IMPORT',
      consentText: IMPORT_CONSENT_TEXT,
      confirmedAt: now,
    })
    expect(repo.updateMany).toHaveBeenCalledWith(
      ['u'],
      expect.objectContaining({ status: 'PENDING', unsubscribedAt: null }),
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'import', targetId: NL }),
    )

    // Background confirmation: only the reactivated row.
    repo.findByEmails.mockResolvedValue(ok([]))
    await result.background
    expect(repo.findByEmails).toHaveBeenLastCalledWith(NL, ['saiu@x.com'])
  })

  it('sends confirmations to the PENDING rows in the background', async () => {
    repo.findByEmails.mockResolvedValueOnce(ok([])).mockResolvedValueOnce(
      ok([
        createFakeCrmNewsletterSubscriber({
          email: 'novo@x.com',
          status: 'PENDING',
        }),
        createFakeCrmNewsletterSubscriber({
          email: 'x@x.com',
          status: 'ACTIVE',
        }),
      ]),
    )
    const result = expectOk(
      await Service.import(
        'u1',
        WS,
        NL,
        {
          rows: [{ email: 'novo@x.com' }],
          consentConfirmed: true,
          sendConfirmation: true,
        },
        now,
      ),
    )
    expect(repo.createMany.mock.calls[0][0][0]).toMatchObject({
      status: 'PENDING',
      confirmedAt: null,
    })
    await result.background
    expect(sendConfirmation).toHaveBeenCalledTimes(1)
  })

  it('returns without background work when nothing needs a confirmation', async () => {
    repo.findByEmails.mockResolvedValue(ok([]))
    const result = expectOk(
      await Service.import(
        'u1',
        WS,
        NL,
        {
          rows: [{ email: 'a@b.com' }],
          consentConfirmed: true,
          sendConfirmation: false,
        },
        now,
      ),
    )
    expect(result.background).toBeUndefined()
    expect(repo.updateMany).not.toHaveBeenCalled()
  })

  it('still answers when the confirmation lookups fail', async () => {
    workspaceRepo.findById.mockResolvedValueOnce(err(databaseError()))
    const a = await Service.import(
      'u1',
      WS,
      NL,
      {
        rows: [{ email: 'saiu@x.com' }],
        consentConfirmed: true,
        sendConfirmation: false,
      },
      now,
    )
    expect(expectOk(a).background).toBeUndefined()

    repo.findByEmails
      .mockResolvedValueOnce(ok(existing))
      .mockResolvedValueOnce(err(databaseError()))
    const b = await Service.import(
      'u1',
      WS,
      NL,
      {
        rows: [{ email: 'saiu@x.com' }],
        consentConfirmed: true,
        sendConfirmation: false,
      },
      now,
    )
    expect(expectOk(b).reactivated).toBe(1)
  })

  it('caps the rows when the confirmation e-mail is asked', async () => {
    const many = Array.from(
      { length: CRM_NEWSLETTER_IMPORT_CONFIRM_MAX_ROWS + 1 },
      (_, i) => ({ email: `p${i}@x.com` }),
    )
    expectErr(
      await Service.import(
        'u1',
        WS,
        NL,
        { rows: many, consentConfirmed: true, sendConfirmation: true },
        now,
      ),
      'CRM_NEWSLETTER_IMPORT_INVALID',
    )
  })

  it('refuses an archived newsletter', async () => {
    newsletterRepo.findById.mockResolvedValue(
      ok(createFakeCrmNewsletter({ ...newsletter, status: 'ARCHIVED' })),
    )
    expectErr(
      await Service.import(
        'u1',
        WS,
        NL,
        {
          rows: [{ email: 'a@b.com' }],
          consentConfirmed: true,
          sendConfirmation: false,
        },
        now,
      ),
      'CRM_NEWSLETTER_ARCHIVED',
    )
  })

  it.each([
    [
      'opt-outs',
      () => optOutRepo.indexByWorkspace.mockResolvedValue(err(databaseError())),
    ],
    [
      'existing',
      () => repo.findByEmails.mockResolvedValue(err(databaseError())),
    ],
    [
      'people',
      () => repo.personIdsByEmails.mockResolvedValue(err(databaseError())),
    ],
    ['insert', () => repo.createMany.mockResolvedValue(err(databaseError()))],
    [
      'reactivation',
      () => repo.updateMany.mockResolvedValue(err(databaseError())),
    ],
  ])('propagates a %s failure', async (_n, arrange) => {
    arrange()
    expectErr(
      await Service.import(
        'u1',
        WS,
        NL,
        { rows, consentConfirmed: true, sendConfirmation: false },
        now,
      ),
      'DATABASE_ERROR',
    )
  })
})

describe('exportCsv', () => {
  it('writes every row with the consent evidence in São Paulo time and audits', async () => {
    repo.listAll.mockResolvedValue(
      ok([
        createFakeCrmNewsletterSubscriber({
          email: 'ana@x.com',
          name: 'Ana',
          consentText: '=cmd',
          createdAt: new Date('2026-10-28T02:30:00.000Z'),
        }),
      ]),
    )
    const out = expectOk(await Service.exportCsv('u1', WS, NL))
    expect(out.filename).toBe('assinantes-novidades.csv')
    const lines = out.csv.replace(/^﻿/, '').split('\r\n')
    expect(lines[0]).toContain('E-mail,Nome,Status,Origem')
    expect(lines[1]).toContain('ana@x.com,Ana,Ativo,Manual')
    expect(lines[1]).toContain("'=cmd")
    expect(lines[1]).toContain('27/10/2026 23:30')
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'export_completed',
        meta: expect.objectContaining({ rows: 1 }),
      }),
    )
  })

  it('propagates failures', async () => {
    repo.listAll.mockResolvedValue(err(databaseError()))
    expectErr(await Service.exportCsv('u1', WS, NL), 'DATABASE_ERROR')
    newsletterRepo.findById.mockResolvedValue(err(crmNewsletterNotFound()))
    expectErr(await Service.exportCsv('u1', WS, NL), 'CRM_NEWSLETTER_NOT_FOUND')
  })
})

describe('remove', () => {
  it('deletes and audits', async () => {
    repo.findById.mockResolvedValue(
      ok(createFakeCrmNewsletterSubscriber({ id: 's1' })),
    )
    repo.delete.mockResolvedValue(ok(undefined))
    expectOk(await Service.remove('u1', WS, NL, 's1'))
    expect(repo.findById).toHaveBeenCalledWith('s1', NL)
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'delete', targetId: 's1' }),
    )
  })

  it('propagates failures and denies a VIEWER', async () => {
    repo.findById.mockResolvedValue(err(crmNewsletterSubscriberNotFound()))
    expectErr(
      await Service.remove('u1', WS, NL, 's1'),
      'CRM_NEWSLETTER_SUBSCRIBER_NOT_FOUND',
    )
    repo.findById.mockResolvedValue(ok(createFakeCrmNewsletterSubscriber()))
    repo.delete.mockResolvedValue(err(databaseError()))
    expectErr(await Service.remove('u1', WS, NL, 's1'), 'DATABASE_ERROR')
    newsletterRepo.findById.mockResolvedValue(err(databaseError()))
    expectErr(await Service.remove('u1', WS, NL, 's1'), 'DATABASE_ERROR')
    asRole('VIEWER')
    expectErr(await Service.remove('u1', WS, NL, 's1'), 'FORBIDDEN')
  })
})

describe('resendConfirmation', () => {
  const pending = createFakeCrmNewsletterSubscriber({
    id: 's1',
    status: 'PENDING',
    confirmSentAt: new Date(now.getTime() - 11 * 60 * 1000),
  })

  it('resends and audits', async () => {
    repo.findById.mockResolvedValue(ok(pending))
    expect(
      expectOk(await Service.resendConfirmation('u1', WS, NL, 's1', now)),
    ).toEqual({ sent: true })
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'send' }),
    )
  })

  it('throttles to once per 10 minutes', async () => {
    repo.findById.mockResolvedValue(
      ok({ ...pending, confirmSentAt: new Date(now.getTime() - 60 * 1000) }),
    )
    const error = expectErr(
      await Service.resendConfirmation('u1', WS, NL, 's1', now),
      'RATE_LIMITED',
    )
    expect(error.message).toContain('9 min')
  })

  it('only for PENDING subscribers', async () => {
    repo.findById.mockResolvedValue(ok({ ...pending, status: 'ACTIVE' }))
    expectErr(
      await Service.resendConfirmation('u1', WS, NL, 's1', now),
      'VALIDATION_ERROR',
    )
  })

  it.each([
    [
      'newsletter',
      () => newsletterRepo.findById.mockResolvedValue(err(databaseError())),
    ],
    ['subscriber', () => repo.findById.mockResolvedValue(err(databaseError()))],
    [
      'workspace',
      () => {
        repo.findById.mockResolvedValue(ok(pending))
        workspaceRepo.findById.mockResolvedValue(err(databaseError()))
      },
    ],
    [
      'send',
      () => {
        repo.findById.mockResolvedValue(ok(pending))
        sendConfirmation.mockResolvedValue(err(databaseError()))
      },
    ],
  ])('propagates a %s failure', async (_n, arrange) => {
    arrange()
    expectErr(
      await Service.resendConfirmation('u1', WS, NL, 's1', now),
      'DATABASE_ERROR',
    )
  })
})
