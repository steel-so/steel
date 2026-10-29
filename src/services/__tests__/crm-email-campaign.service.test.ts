import type { Role } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeCrmEmailCampaign,
  createFakeCrmEmailCampaignRecipient,
} from '@/src/__tests__/factories/crm-email-marketing.factory'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, notFound } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/services/crm-notifications')
vi.mock('@/src/repositories/sending-domain.repository', () => ({
  SendingDomainRepository: { findVerifiedByName: vi.fn() },
}))
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/crm-email-campaign.repository')
vi.mock('@/src/repositories/crm-person.repository')
vi.mock('@/src/repositories/crm-mailing-list.repository')
vi.mock('@/src/repositories/crm-email-opt-out.repository')
// Version history (E2) is covered in crm-email-template-version.service.test.
vi.mock('@/src/services/crm-email-template-history')
vi.mock('@/src/lib/mail/send', () => ({
  sendEmail: vi.fn(async () => ({ id: 'resend-1' })),
}))

import { sendEmail } from '@/src/lib/mail/send'
import {
  CrmEmailCampaignRecipientRepository,
  CrmEmailCampaignRepository,
} from '@/src/repositories/crm-email-campaign.repository'
import { CrmEmailOptOutRepository } from '@/src/repositories/crm-email-opt-out.repository'
import { CrmMailingListMemberRepository } from '@/src/repositories/crm-mailing-list.repository'
import { CrmPersonRepository } from '@/src/repositories/crm-person.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { SendingDomainRepository } from '@/src/repositories/sending-domain.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { CrmEmailCampaignService } from '../crm-email-campaign.service'
import { notifyCrmCampaignFinished } from '../crm-notifications'

const mockedMembershipRepo = vi.mocked(MembershipRepository)
const mockedCampaignRepo = vi.mocked(CrmEmailCampaignRepository)
const mockedRecipientRepo = vi.mocked(CrmEmailCampaignRecipientRepository)
const mockedPersonRepo = vi.mocked(CrmPersonRepository)
const mockedMailingListMemberRepo = vi.mocked(CrmMailingListMemberRepository)
const mockedOptOutRepo = vi.mocked(CrmEmailOptOutRepository)
const mockedSendEmail = vi.mocked(sendEmail)
const mockedModuleAccess = vi.mocked(WorkspaceModuleAccessRepository)

function optOutIndex(emails: string[] = [], personIds: string[] = []) {
  return ok({ emails: new Set(emails), personIds: new Set(personIds) })
}

function fakePerson(id: string, name: string, email: string) {
  return {
    id,
    name,
    emails: [email],
    phones: [],
    city: null,
    jobTitle: null,
    linkedin: null,
    avatar: null,
    companyId: null,
    workspaceId: 'ws1',
    createdById: 'u1',
    updatedById: null,
    position: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  }
}

const mockedSendingDomains = vi.mocked(SendingDomainRepository)

beforeEach(() => {
  mockedOptOutRepo.indexByWorkspace.mockResolvedValue(optOutIndex())
  mockedSendingDomains.findVerifiedByName.mockResolvedValue(
    ok({ id: 'dom1' } as never),
  )
})

describe('CrmEmailCampaignService.send() — sender (ADR 0055)', () => {
  function draft(fromAddress: string) {
    mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
      ok(createFakeMembership({ role: 'MEMBER' })),
    )
    mockedCampaignRepo.findById.mockResolvedValue(
      ok(
        createFakeCrmEmailCampaign({ id: 'c1', status: 'DRAFT', fromAddress }),
      ),
    )
    mockedCampaignRepo.setStatus.mockClear()
    mockedSendEmail.mockClear()
  }

  it('refuses a From outside the verified domains before changing anything', async () => {
    draft('mkt@acme.com')
    mockedSendingDomains.findVerifiedByName.mockResolvedValue(ok(null))
    const result = await CrmEmailCampaignService.send('u1', 'ws1', 'c1')
    expectErr(result, 'SENDING_DOMAIN_NOT_VERIFIED')
    if (!result.ok) {
      expect(result.error.message).toContain('Ajustes › Domínios de e-mail')
    }
    expect(mockedCampaignRepo.setStatus).not.toHaveBeenCalled()
    expect(mockedSendEmail).not.toHaveBeenCalled()
  })

  it('propagates a database error of the sender check', async () => {
    draft('mkt@acme.com')
    mockedSendingDomains.findVerifiedByName.mockResolvedValue(
      err(databaseError()),
    )
    expectErr(
      await CrmEmailCampaignService.send('u1', 'ws1', 'c1'),
      'DATABASE_ERROR',
    )
  })

  it('lets a platform-domain address through without a verified domain', async () => {
    draft('contato@stratustelecom.com.br')
    mockedSendingDomains.findVerifiedByName.mockResolvedValue(ok(null))
    mockedRecipientRepo.listByCampaign.mockResolvedValue(ok([]))
    // Passes the sender check and stops at the next rule.
    expectErr(
      await CrmEmailCampaignService.send('u1', 'ws1', 'c1'),
      'CRM_EMAIL_CAMPAIGN_NO_RECIPIENTS',
    )
  })
})

describe('CrmEmailCampaignService', () => {
  describe('update()', () => {
    it('should return CRM_EMAIL_CAMPAIGN_ALREADY_SENT for a sent campaign', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'MEMBER' })),
      )
      mockedCampaignRepo.findById.mockResolvedValue(
        ok(createFakeCrmEmailCampaign({ id: 'c1', status: 'SENT' })),
      )

      expectErr(
        await CrmEmailCampaignService.update('u1', 'ws1', 'c1', {}),
        'CRM_EMAIL_CAMPAIGN_ALREADY_SENT',
      )
    })
  })

  describe('create()', () => {
    it('should create a campaign with recipients from all people with an email', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'MEMBER' })),
      )
      mockedCampaignRepo.create.mockResolvedValue(
        ok(createFakeCrmEmailCampaign({ id: 'c1' })),
      )
      mockedPersonRepo.listByWorkspace.mockResolvedValue(
        ok([
          {
            id: 'p1',
            name: 'Jane',
            emails: ['jane@acme.com'],
            phones: [],
            city: null,
            jobTitle: null,
            linkedin: null,
            avatar: null,
            companyId: null,
            workspaceId: 'ws1',
            createdById: 'u1',
            updatedById: null,
            position: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
            deletedAt: null,
          },
        ]),
      )
      mockedRecipientRepo.createMany.mockResolvedValue(ok(1))

      const dto = expectOk(
        await CrmEmailCampaignService.create('u1', 'ws1', {
          subject: 'Promo',
          contentHtml: '<p>Oi</p>',
          fromAddress: 'crm@stratustelecom.com.br',
          recipientScope: 'ALL',
        }),
      )
      expect(dto.id).toBe('c1')
      expect(mockedRecipientRepo.createMany).toHaveBeenCalledWith('c1', [
        { email: 'jane@acme.com', name: 'Jane', personId: 'p1' },
      ])
    })

    // Bug: "Selecionados" sem ninguém marcado disparava pra todo mundo com
    // e-mail no workspace. Seleção vazia nunca pode virar "todos".
    it('should reject a SELECTED scope with an empty selection without fanning out to everyone', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'MEMBER' })),
      )
      mockedCampaignRepo.create.mockResolvedValue(
        ok(createFakeCrmEmailCampaign({ id: 'c1' })),
      )
      mockedPersonRepo.listByWorkspace.mockResolvedValue(ok([]))

      expectErr(
        await CrmEmailCampaignService.create('u1', 'ws1', {
          subject: 'Promo',
          contentHtml: '<p>Oi</p>',
          fromAddress: 'crm@stratustelecom.com.br',
          recipientScope: 'SELECTED',
          personIds: [],
          mailingListIds: [],
          extraEmails: [],
        }),
        'CRM_EMAIL_CAMPAIGN_NO_RECIPIENTS',
      )
      expect(mockedPersonRepo.listByWorkspace).not.toHaveBeenCalled()
      expect(mockedCampaignRepo.create).not.toHaveBeenCalled()
      expect(mockedRecipientRepo.createMany).not.toHaveBeenCalled()
    })

    it('should combine personIds + mailingListIds + extraEmails, deduping by email', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'MEMBER' })),
      )
      mockedCampaignRepo.create.mockResolvedValue(
        ok(createFakeCrmEmailCampaign({ id: 'c1' })),
      )
      mockedPersonRepo.findById.mockResolvedValue(
        ok({
          id: 'p1',
          name: 'Jane',
          emails: ['jane@acme.com'],
          phones: [],
          city: null,
          jobTitle: null,
          linkedin: null,
          avatar: null,
          companyId: null,
          workspaceId: 'ws1',
          createdById: 'u1',
          updatedById: null,
          position: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        }),
      )
      mockedMailingListMemberRepo.listByList.mockResolvedValue(
        ok([
          {
            id: 'm1',
            mailingListId: 'l1',
            email: 'JANE@ACME.COM',
            name: null,
            personId: null,
            createdAt: new Date(),
          },
          {
            id: 'm2',
            mailingListId: 'l1',
            email: 'list-member@acme.com',
            name: 'List Member',
            personId: null,
            createdAt: new Date(),
          },
        ]),
      )
      mockedRecipientRepo.createMany.mockResolvedValue(ok(2))

      expectOk(
        await CrmEmailCampaignService.create('u1', 'ws1', {
          subject: 'Promo',
          contentHtml: '<p>Oi</p>',
          fromAddress: 'crm@stratustelecom.com.br',
          recipientScope: 'SELECTED',
          personIds: ['p1'],
          mailingListIds: ['l1'],
          extraEmails: ['avulso@acme.com'],
        }),
      )

      // jane@acme.com vem tanto do personId quanto (com outra caixa) da
      // lista — só deve aparecer uma vez.
      expect(mockedRecipientRepo.createMany).toHaveBeenCalledWith('c1', [
        { email: 'jane@acme.com', name: 'Jane', personId: 'p1' },
        {
          email: 'list-member@acme.com',
          name: 'List Member',
          personId: undefined,
        },
        { email: 'avulso@acme.com' },
      ])
    })
  })

  describe('create() with LGPD opt-outs', () => {
    it('should exclude opted-out addresses and people from ALL', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'MEMBER' })),
      )
      mockedCampaignRepo.create.mockResolvedValue(
        ok(createFakeCrmEmailCampaign({ id: 'c1' })),
      )
      mockedPersonRepo.listByWorkspace.mockResolvedValue(
        ok([
          fakePerson('p1', 'Jane', 'jane@acme.com'),
          fakePerson('p2', 'Saiu por e-mail', 'SAIU@acme.com'),
          fakePerson('p3', 'Saiu por pessoa', 'outro@acme.com'),
        ]),
      )
      mockedOptOutRepo.indexByWorkspace.mockResolvedValue(
        optOutIndex(['saiu@acme.com'], ['p3']),
      )
      mockedRecipientRepo.createMany.mockResolvedValue(ok(1))

      expectOk(
        await CrmEmailCampaignService.create('u1', 'ws1', {
          subject: 'Promo',
          contentHtml: '<p>Oi</p>',
          fromAddress: 'crm@stratustelecom.com.br',
          recipientScope: 'ALL',
        }),
      )
      expect(mockedOptOutRepo.indexByWorkspace).toHaveBeenCalledWith('ws1')
      expect(mockedRecipientRepo.createMany).toHaveBeenCalledWith('c1', [
        { email: 'jane@acme.com', name: 'Jane', personId: 'p1' },
      ])
    })

    it('should exclude opted-out extra emails and fail when nobody is left', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'MEMBER' })),
      )
      mockedOptOutRepo.indexByWorkspace.mockResolvedValue(
        optOutIndex(['avulso@acme.com']),
      )

      expectErr(
        await CrmEmailCampaignService.create('u1', 'ws1', {
          subject: 'Promo',
          contentHtml: '<p>Oi</p>',
          fromAddress: 'crm@stratustelecom.com.br',
          recipientScope: 'SELECTED',
          extraEmails: ['Avulso@acme.com'],
        }),
        'CRM_EMAIL_CAMPAIGN_NO_RECIPIENTS',
      )
      expect(mockedCampaignRepo.create).not.toHaveBeenCalled()
    })
  })

  describe('send()', () => {
    it('should add the unsubscribe footer and RFC 8058 headers, and skip opted-out recipients', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'MEMBER' })),
      )
      const campaign = createFakeCrmEmailCampaign({
        id: 'c1',
        status: 'DRAFT',
        contentHtml: '<html><body><p>Oi</p></body></html>',
      })
      mockedCampaignRepo.findById.mockResolvedValue(ok(campaign))
      mockedCampaignRepo.setStatus.mockResolvedValue(
        ok({ ...campaign, status: 'SENT' }),
      )
      mockedRecipientRepo.listByCampaign.mockResolvedValue(
        ok([
          createFakeCrmEmailCampaignRecipient({
            id: 'r1',
            campaignId: 'c1',
            email: 'jane@acme.com',
          }),
          createFakeCrmEmailCampaignRecipient({
            id: 'r2',
            campaignId: 'c1',
            email: 'Saiu@acme.com',
          }),
        ]),
      )
      mockedRecipientRepo.markSent.mockResolvedValue(ok(undefined))
      mockedRecipientRepo.markSkipped.mockResolvedValue(ok(undefined))
      mockedOptOutRepo.indexByWorkspace.mockResolvedValue(
        optOutIndex(['saiu@acme.com']),
      )

      expectOk(await CrmEmailCampaignService.send('u1', 'ws1', 'c1'))

      expect(mockedSendEmail).toHaveBeenCalledTimes(1)
      const params = mockedSendEmail.mock.calls[0][0]
      expect(params.to).toBe('jane@acme.com')
      expect(params.html).toMatch(
        /\/unsubscribe\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+"/,
      )
      expect(params.html).toMatch(/<\/div><\/body><\/html>$/)
      expect(params.headers?.['List-Unsubscribe']).toMatch(
        /^<https?:\/\/.+\/api\/crm\/unsubscribe\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+>$/,
      )
      expect(params.headers?.['List-Unsubscribe-Post']).toBe(
        'List-Unsubscribe=One-Click',
      )
      expect(mockedRecipientRepo.markSkipped).toHaveBeenCalledWith('r2')
      expect(mockedCampaignRepo.setStatus).toHaveBeenLastCalledWith(
        'c1',
        'SENT',
        expect.any(Date),
      )
      // Manual send: the clicker is the actor (not notified about it).
      expect(notifyCrmCampaignFinished).toHaveBeenCalledWith({
        workspaceId: 'ws1',
        campaign,
        status: 'SENT',
        sent: 1,
        failed: 0,
        actorId: 'u1',
      })
    })

    it('should notify the creator (no actor) when the scheduler sends and every e-mail fails', async () => {
      vi.mocked(notifyCrmCampaignFinished).mockClear()
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'MEMBER' })),
      )
      const campaign = createFakeCrmEmailCampaign({
        id: 'c1',
        status: 'SCHEDULED',
      })
      mockedCampaignRepo.findById.mockResolvedValue(ok(campaign))
      mockedCampaignRepo.setStatus.mockResolvedValue(
        ok({ ...campaign, status: 'FAILED' }),
      )
      mockedRecipientRepo.listByCampaign.mockResolvedValue(
        ok([
          createFakeCrmEmailCampaignRecipient({
            id: 'r1',
            campaignId: 'c1',
            email: 'jane@acme.com',
          }),
        ]),
      )
      mockedRecipientRepo.markFailed.mockResolvedValue(ok(undefined))
      mockedOptOutRepo.indexByWorkspace.mockResolvedValue(optOutIndex([]))
      mockedSendEmail.mockRejectedValueOnce(new Error('smtp down'))

      expectOk(await CrmEmailCampaignService.send('u1', 'ws1', 'c1'))

      expect(notifyCrmCampaignFinished).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'FAILED',
          sent: 0,
          failed: 1,
          actorId: null,
        }),
      )
    })

    it('should refuse to send a campaign without recipients', async () => {
      mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
        ok(createFakeMembership({ role: 'MEMBER' })),
      )
      mockedCampaignRepo.findById.mockResolvedValue(
        ok(createFakeCrmEmailCampaign({ id: 'c1', status: 'DRAFT' })),
      )
      mockedRecipientRepo.listByCampaign.mockResolvedValue(ok([]))

      expectErr(
        await CrmEmailCampaignService.send('u1', 'ws1', 'c1'),
        'CRM_EMAIL_CAMPAIGN_NO_RECIPIENTS',
      )
      expect(mockedCampaignRepo.setStatus).not.toHaveBeenCalledWith(
        'c1',
        'SENDING',
      )
    })
  })
})

const baseCreate = {
  subject: 'Promo',
  contentHtml: '<p>Oi</p>',
  fromAddress: 'crm@stratustelecom.com.br',
}

function asRole(role: Role) {
  mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )
}

function listMember(email: string, personId: string | null = null) {
  return {
    id: `m-${email}`,
    mailingListId: 'l1',
    email,
    name: null,
    personId,
    createdAt: new Date(),
  }
}

describe('CrmEmailCampaignService — authorization', () => {
  it('should return FORBIDDEN for a non-member', async () => {
    mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(await CrmEmailCampaignService.list('u1', 'ws1'), 'FORBIDDEN')
  })

  it('should return MODULE_DISABLED when the CRM is off', async () => {
    asRole('OWNER')
    mockedModuleAccess.isEnabled.mockResolvedValueOnce(ok(false))
    expectErr(
      await CrmEmailCampaignService.send('u1', 'ws1', 'c1'),
      'MODULE_DISABLED',
    )
    expect(mockedSendEmail).not.toHaveBeenCalled()
  })

  it('should block a suspended workspace', async () => {
    mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
      ok(createFakeMembership({ role: 'OWNER', workspaceStatus: 'SUSPENDED' })),
    )
    expectErr(
      await CrmEmailCampaignService.getById('u1', 'ws1', 'c1'),
      'WORKSPACE_SUSPENDED',
    )
  })

  it.each([
    [
      'create',
      () =>
        CrmEmailCampaignService.create('u1', 'ws1', {
          ...baseCreate,
          recipientScope: 'ALL',
        }),
    ],
    ['update', () => CrmEmailCampaignService.update('u1', 'ws1', 'c1', {})],
    ['send', () => CrmEmailCampaignService.send('u1', 'ws1', 'c1')],
  ])('should forbid a VIEWER from %s', async (_name, call) => {
    asRole('VIEWER')
    expectErr(await call(), 'FORBIDDEN')
    expect(mockedCampaignRepo.findById).not.toHaveBeenCalled()
    expect(mockedCampaignRepo.create).not.toHaveBeenCalled()
    expect(mockedPersonRepo.listByWorkspace).not.toHaveBeenCalled()
  })
})

describe('CrmEmailCampaignService — reads', () => {
  it('should list campaigns for a VIEWER', async () => {
    asRole('VIEWER')
    mockedCampaignRepo.listByWorkspace.mockResolvedValue(
      ok([
        {
          ...createFakeCrmEmailCampaign({ id: 'c1' }),
          _count: { recipients: 0 },
          recipients: [],
        },
      ]),
    )
    const dtos = expectOk(await CrmEmailCampaignService.list('u1', 'ws1'))
    expect(dtos.map((d) => d.id)).toEqual(['c1'])
  })

  it('should propagate list errors', async () => {
    asRole('VIEWER')
    mockedCampaignRepo.listByWorkspace.mockResolvedValue(err(databaseError()))
    expectErr(await CrmEmailCampaignService.list('u1', 'ws1'), 'DATABASE_ERROR')
  })

  it('should get a campaign scoped to the workspace', async () => {
    asRole('VIEWER')
    mockedCampaignRepo.findById.mockResolvedValue(
      ok(createFakeCrmEmailCampaign({ id: 'c1' })),
    )
    const dto = expectOk(
      await CrmEmailCampaignService.getById('u1', 'ws1', 'c1'),
    )
    expect(dto.id).toBe('c1')
    expect(mockedCampaignRepo.findById).toHaveBeenCalledWith('c1', 'ws1')
  })

  it('should return not found on getById for another workspace', async () => {
    asRole('VIEWER')
    mockedCampaignRepo.findById.mockResolvedValue(
      err(notFound('CrmEmailCampaign')),
    )
    expectErr(
      await CrmEmailCampaignService.getById('u1', 'ws1', 'c1'),
      'RESOURCE_NOT_FOUND',
    )
  })

  it('should list recipients of a campaign', async () => {
    asRole('VIEWER')
    mockedCampaignRepo.findById.mockResolvedValue(
      ok(createFakeCrmEmailCampaign({ id: 'c1' })),
    )
    mockedRecipientRepo.listByCampaign.mockResolvedValue(
      ok([createFakeCrmEmailCampaignRecipient({ id: 'r1', campaignId: 'c1' })]),
    )
    const dtos = expectOk(
      await CrmEmailCampaignService.listRecipients('u1', 'ws1', 'c1'),
    )
    expect(dtos.map((d) => d.id)).toEqual(['r1'])
  })

  it('should not list recipients to a non-member', async () => {
    mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(
      await CrmEmailCampaignService.listRecipients('u1', 'ws1', 'c1'),
      'FORBIDDEN',
    )
    expect(mockedCampaignRepo.findById).not.toHaveBeenCalled()
  })

  it('should not list recipients of a campaign outside the workspace', async () => {
    asRole('VIEWER')
    mockedCampaignRepo.findById.mockResolvedValue(
      err(notFound('CrmEmailCampaign')),
    )
    expectErr(
      await CrmEmailCampaignService.listRecipients('u1', 'ws1', 'c1'),
      'RESOURCE_NOT_FOUND',
    )
    expect(mockedRecipientRepo.listByCampaign).not.toHaveBeenCalled()
  })

  it('should propagate recipient listing errors', async () => {
    asRole('VIEWER')
    mockedCampaignRepo.findById.mockResolvedValue(
      ok(createFakeCrmEmailCampaign({ id: 'c1' })),
    )
    mockedRecipientRepo.listByCampaign.mockResolvedValue(err(databaseError()))
    expectErr(
      await CrmEmailCampaignService.listRecipients('u1', 'ws1', 'c1'),
      'DATABASE_ERROR',
    )
  })
})

describe('CrmEmailCampaignService — create() recipient resolution', () => {
  it('should skip people without an email in ALL', async () => {
    asRole('MEMBER')
    mockedCampaignRepo.create.mockResolvedValue(
      ok(createFakeCrmEmailCampaign({ id: 'c1' })),
    )
    mockedPersonRepo.listByWorkspace.mockResolvedValue(
      ok([
        fakePerson('p1', 'Jane', 'jane@acme.com'),
        { ...fakePerson('p2', 'Sem e-mail', 'x'), emails: [] },
      ]),
    )
    mockedRecipientRepo.createMany.mockResolvedValue(ok(1))

    expectOk(
      await CrmEmailCampaignService.create('u1', 'ws1', {
        ...baseCreate,
        recipientScope: 'ALL',
      }),
    )
    expect(mockedRecipientRepo.createMany).toHaveBeenCalledWith('c1', [
      { email: 'jane@acme.com', name: 'Jane', personId: 'p1' },
    ])
  })

  it('should fail with no recipients when nobody in ALL has an email', async () => {
    asRole('MEMBER')
    mockedPersonRepo.listByWorkspace.mockResolvedValue(ok([]))
    expectErr(
      await CrmEmailCampaignService.create('u1', 'ws1', {
        ...baseCreate,
        recipientScope: 'ALL',
      }),
      'CRM_EMAIL_CAMPAIGN_NO_RECIPIENTS',
    )
    expect(mockedCampaignRepo.create).not.toHaveBeenCalled()
  })

  it('should propagate a person listing error in ALL', async () => {
    asRole('MEMBER')
    mockedPersonRepo.listByWorkspace.mockResolvedValue(err(databaseError()))
    expectErr(
      await CrmEmailCampaignService.create('u1', 'ws1', {
        ...baseCreate,
        recipientScope: 'ALL',
      }),
      'DATABASE_ERROR',
    )
    expect(mockedCampaignRepo.create).not.toHaveBeenCalled()
  })

  it('should treat an omitted selection in SELECTED as empty', async () => {
    asRole('MEMBER')
    expectErr(
      await CrmEmailCampaignService.create('u1', 'ws1', {
        ...baseCreate,
        recipientScope: 'SELECTED',
      }),
      'CRM_EMAIL_CAMPAIGN_NO_RECIPIENTS',
    )
    expect(mockedPersonRepo.listByWorkspace).not.toHaveBeenCalled()
  })

  it('should ignore selected people that are missing or have no email', async () => {
    asRole('MEMBER')
    mockedCampaignRepo.create.mockResolvedValue(
      ok(createFakeCrmEmailCampaign({ id: 'c1' })),
    )
    mockedPersonRepo.findById.mockImplementation(async (id: string) => {
      if (id === 'gone') return err(notFound('CrmPerson'))
      if (id === 'noemail') {
        return ok({ ...fakePerson(id, 'X', 'x'), emails: [] })
      }
      return ok(fakePerson(id, 'Jane', 'jane@acme.com'))
    })
    mockedRecipientRepo.createMany.mockResolvedValue(ok(1))

    expectOk(
      await CrmEmailCampaignService.create('u1', 'ws1', {
        ...baseCreate,
        recipientScope: 'SELECTED',
        personIds: ['gone', 'noemail', 'p1'],
      }),
    )
    expect(mockedPersonRepo.findById).toHaveBeenCalledWith('gone', 'ws1')
    expect(mockedRecipientRepo.createMany).toHaveBeenCalledWith('c1', [
      { email: 'jane@acme.com', name: 'Jane', personId: 'p1' },
    ])
  })

  it('should drop blank addresses and list members whose linked person opted out', async () => {
    asRole('MEMBER')
    mockedCampaignRepo.create.mockResolvedValue(
      ok(createFakeCrmEmailCampaign({ id: 'c1' })),
    )
    mockedMailingListMemberRepo.listByList.mockResolvedValue(
      ok([
        listMember('   '),
        listMember('saiu@acme.com', 'p9'),
        listMember('fica@acme.com', 'p2'),
      ]),
    )
    mockedOptOutRepo.indexByWorkspace.mockResolvedValue(optOutIndex([], ['p9']))
    mockedRecipientRepo.createMany.mockResolvedValue(ok(1))

    expectOk(
      await CrmEmailCampaignService.create('u1', 'ws1', {
        ...baseCreate,
        recipientScope: 'SELECTED',
        mailingListIds: ['l1'],
      }),
    )
    expect(mockedRecipientRepo.createMany).toHaveBeenCalledWith('c1', [
      { email: 'fica@acme.com', name: undefined, personId: 'p2' },
    ])
  })

  it('should propagate a mailing list lookup error', async () => {
    asRole('MEMBER')
    mockedMailingListMemberRepo.listByList.mockResolvedValue(
      err(databaseError()),
    )
    expectErr(
      await CrmEmailCampaignService.create('u1', 'ws1', {
        ...baseCreate,
        recipientScope: 'SELECTED',
        mailingListIds: ['l1'],
      }),
      'DATABASE_ERROR',
    )
    expect(mockedCampaignRepo.create).not.toHaveBeenCalled()
  })

  it('should propagate an opt-out index error', async () => {
    asRole('MEMBER')
    mockedOptOutRepo.indexByWorkspace.mockResolvedValue(err(databaseError()))
    expectErr(
      await CrmEmailCampaignService.create('u1', 'ws1', {
        ...baseCreate,
        recipientScope: 'SELECTED',
        extraEmails: ['a@acme.com'],
      }),
      'DATABASE_ERROR',
    )
    expect(mockedCampaignRepo.create).not.toHaveBeenCalled()
  })

  it('should propagate a campaign creation error without creating recipients', async () => {
    asRole('MEMBER')
    mockedCampaignRepo.create.mockResolvedValue(err(databaseError()))
    expectErr(
      await CrmEmailCampaignService.create('u1', 'ws1', {
        ...baseCreate,
        recipientScope: 'SELECTED',
        extraEmails: ['a@acme.com'],
      }),
      'DATABASE_ERROR',
    )
    expect(mockedRecipientRepo.createMany).not.toHaveBeenCalled()
  })

  it('should propagate a recipient insert error', async () => {
    asRole('MEMBER')
    mockedCampaignRepo.create.mockResolvedValue(
      ok(createFakeCrmEmailCampaign({ id: 'c1' })),
    )
    mockedRecipientRepo.createMany.mockResolvedValue(err(databaseError()))
    expectErr(
      await CrmEmailCampaignService.create('u1', 'ws1', {
        ...baseCreate,
        recipientScope: 'SELECTED',
        extraEmails: ['a@acme.com'],
      }),
      'DATABASE_ERROR',
    )
  })
})

describe('CrmEmailCampaignService — update()', () => {
  it('should update a scheduled campaign', async () => {
    asRole('MEMBER')
    mockedCampaignRepo.findById.mockResolvedValue(
      ok(createFakeCrmEmailCampaign({ id: 'c1', status: 'SCHEDULED' })),
    )
    mockedCampaignRepo.update.mockResolvedValue(
      ok(createFakeCrmEmailCampaign({ id: 'c1', subject: 'Novo' })),
    )

    const dto = expectOk(
      await CrmEmailCampaignService.update('u1', 'ws1', 'c1', {
        subject: 'Novo',
      }),
    )
    expect(dto.subject).toBe('Novo')
    expect(mockedCampaignRepo.update).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({ subject: 'Novo' }),
    )
  })

  it('should return not found for a missing campaign', async () => {
    asRole('MEMBER')
    mockedCampaignRepo.findById.mockResolvedValue(
      err(notFound('CrmEmailCampaign')),
    )
    expectErr(
      await CrmEmailCampaignService.update('u1', 'ws1', 'c1', {}),
      'RESOURCE_NOT_FOUND',
    )
  })

  it('should propagate update errors', async () => {
    asRole('MEMBER')
    mockedCampaignRepo.findById.mockResolvedValue(
      ok(createFakeCrmEmailCampaign({ id: 'c1', status: 'DRAFT' })),
    )
    mockedCampaignRepo.update.mockResolvedValue(err(databaseError()))
    expectErr(
      await CrmEmailCampaignService.update('u1', 'ws1', 'c1', {}),
      'DATABASE_ERROR',
    )
  })
})

describe('CrmEmailCampaignService — send() outcomes', () => {
  function setupSend(
    recipients: ReturnType<typeof createFakeCrmEmailCampaignRecipient>[],
    status: 'DRAFT' | 'SCHEDULED' = 'DRAFT',
  ) {
    asRole('MEMBER')
    const campaign = createFakeCrmEmailCampaign({ id: 'c1', status })
    mockedCampaignRepo.findById.mockResolvedValue(ok(campaign))
    mockedCampaignRepo.setStatus.mockImplementation(async (_id, next) =>
      ok({ ...campaign, status: next }),
    )
    mockedRecipientRepo.listByCampaign.mockResolvedValue(ok(recipients))
    mockedRecipientRepo.markSent.mockResolvedValue(ok(undefined))
    mockedRecipientRepo.markFailed.mockResolvedValue(ok(undefined))
    mockedRecipientRepo.markSkipped.mockResolvedValue(ok(undefined))
  }

  const r1 = createFakeCrmEmailCampaignRecipient({
    id: 'r1',
    email: 'a@acme.com',
  })
  const r2 = createFakeCrmEmailCampaignRecipient({
    id: 'r2',
    email: 'b@acme.com',
  })

  it('should refuse to resend a SENT campaign', async () => {
    asRole('MEMBER')
    mockedCampaignRepo.findById.mockResolvedValue(
      ok(createFakeCrmEmailCampaign({ id: 'c1', status: 'SENT' })),
    )
    expectErr(
      await CrmEmailCampaignService.send('u1', 'ws1', 'c1'),
      'CRM_EMAIL_CAMPAIGN_ALREADY_SENT',
    )
    expect(mockedRecipientRepo.listByCampaign).not.toHaveBeenCalled()
  })

  it('should return not found for a missing campaign', async () => {
    asRole('MEMBER')
    mockedCampaignRepo.findById.mockResolvedValue(
      err(notFound('CrmEmailCampaign')),
    )
    expectErr(
      await CrmEmailCampaignService.send('u1', 'ws1', 'c1'),
      'RESOURCE_NOT_FOUND',
    )
  })

  it('should propagate a recipient listing error', async () => {
    setupSend([])
    mockedRecipientRepo.listByCampaign.mockResolvedValue(err(databaseError()))
    expectErr(
      await CrmEmailCampaignService.send('u1', 'ws1', 'c1'),
      'DATABASE_ERROR',
    )
    expect(mockedSendEmail).not.toHaveBeenCalled()
  })

  it('should not start sending when the opt-out index fails', async () => {
    setupSend([r1])
    mockedOptOutRepo.indexByWorkspace.mockResolvedValue(err(databaseError()))
    expectErr(
      await CrmEmailCampaignService.send('u1', 'ws1', 'c1'),
      'DATABASE_ERROR',
    )
    expect(mockedCampaignRepo.setStatus).not.toHaveBeenCalled()
    expect(mockedSendEmail).not.toHaveBeenCalled()
  })

  it('should mark partial provider failures and still finish as SENT', async () => {
    setupSend([r1, r2], 'SCHEDULED')
    mockedSendEmail
      .mockResolvedValueOnce({ id: 'resend-1' } as never)
      .mockRejectedValueOnce(new Error('Resend 500'))

    const dto = expectOk(await CrmEmailCampaignService.send('u1', 'ws1', 'c1'))
    expect(dto.status).toBe('SENT')
    expect(mockedRecipientRepo.markSent).toHaveBeenCalledWith('r1', 'resend-1')
    expect(mockedRecipientRepo.markFailed).toHaveBeenCalledWith(
      'r2',
      'Resend 500',
    )
    expect(mockedCampaignRepo.setStatus).toHaveBeenNthCalledWith(
      1,
      'c1',
      'SENDING',
    )
  })

  it('should mark the campaign FAILED when every attempt fails', async () => {
    setupSend([r1])
    mockedSendEmail.mockRejectedValueOnce('boom')

    const dto = expectOk(await CrmEmailCampaignService.send('u1', 'ws1', 'c1'))
    expect(dto.status).toBe('FAILED')
    expect(mockedRecipientRepo.markFailed).toHaveBeenCalledWith(
      'r1',
      'Falha ao enviar',
    )
  })

  it('should finish as SENT when every recipient opted out (nothing attempted)', async () => {
    setupSend([r1])
    mockedOptOutRepo.indexByWorkspace.mockResolvedValue(
      optOutIndex(['a@acme.com']),
    )

    const dto = expectOk(await CrmEmailCampaignService.send('u1', 'ws1', 'c1'))
    expect(dto.status).toBe('SENT')
    expect(mockedSendEmail).not.toHaveBeenCalled()
    expect(mockedRecipientRepo.markSkipped).toHaveBeenCalledWith('r1')
  })

  it('should skip a recipient whose linked person opted out', async () => {
    setupSend([{ ...r1, personId: 'p1' }])
    mockedOptOutRepo.indexByWorkspace.mockResolvedValue(optOutIndex([], ['p1']))
    expectOk(await CrmEmailCampaignService.send('u1', 'ws1', 'c1'))
    expect(mockedSendEmail).not.toHaveBeenCalled()
    expect(mockedRecipientRepo.markSkipped).toHaveBeenCalledWith('r1')
  })

  it('should propagate the final status update error', async () => {
    setupSend([r1])
    mockedCampaignRepo.setStatus
      .mockResolvedValueOnce(ok(createFakeCrmEmailCampaign({ id: 'c1' })))
      .mockResolvedValueOnce(err(databaseError()))
    expectErr(
      await CrmEmailCampaignService.send('u1', 'ws1', 'c1'),
      'DATABASE_ERROR',
    )
  })
})
