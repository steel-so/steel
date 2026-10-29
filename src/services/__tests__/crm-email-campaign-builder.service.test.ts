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
// ADR 0055 sender check: covered in crm-email-campaign.service.test.
vi.mock('@/src/lib/sending-domain/campaign-sender', () => ({
  checkCampaignSender: vi.fn(async () => ({
    ok: true,
    value: { platform: true },
  })),
}))
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/crm-email-campaign.repository')
vi.mock('@/src/repositories/crm-person.repository')
vi.mock('@/src/repositories/crm-mailing-list.repository')
vi.mock('@/src/repositories/crm-email-opt-out.repository')
vi.mock('@/src/repositories/crm-email-builder.repository')
// Version history (E2) is covered in crm-email-template-version.service.test.
vi.mock('@/src/services/crm-email-template-history')
vi.mock('@/src/lib/mail/send', () => ({
  sendEmail: vi.fn(async () => ({ id: 'resend-1' })),
}))
vi.mock('@/src/services/crm-email-builder.service', () => ({
  renderTemplateForCampaign: vi.fn(),
}))

import { sendEmail } from '@/src/lib/mail/send'
import { CrmEmailBuilderRepository } from '@/src/repositories/crm-email-builder.repository'
import {
  CrmEmailCampaignRecipientRepository,
  CrmEmailCampaignRepository,
} from '@/src/repositories/crm-email-campaign.repository'
import { CrmEmailOptOutRepository } from '@/src/repositories/crm-email-opt-out.repository'
import { CrmPersonRepository } from '@/src/repositories/crm-person.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { renderTemplateForCampaign } from '../crm-email-builder.service'
import { CrmEmailCampaignService } from '../crm-email-campaign.service'

const mockedMembership = vi.mocked(MembershipRepository)
const mockedCampaignRepo = vi.mocked(CrmEmailCampaignRepository)
const mockedRecipientRepo = vi.mocked(CrmEmailCampaignRecipientRepository)
const mockedOptOutRepo = vi.mocked(CrmEmailOptOutRepository)
const mockedPersonRepo = vi.mocked(CrmPersonRepository)
const mockedBuilderRepo = vi.mocked(CrmEmailBuilderRepository)
const mockedRender = vi.mocked(renderTemplateForCampaign)
const mockedSend = vi.mocked(sendEmail)

const BASE = {
  subject: 'Oi {{primeiro_nome|cliente}}',
  html: '<html><body><p>Oi {{nome}} da {{empresa}}</p><a href="{{campaign_link}}">ir</a><a href="{{unsubscribe_url}}">Descadastrar</a></body></html>',
  text: 'Oi {{nome}} {{campaign_link}} Descadastrar {{unsubscribe_url}}',
}

beforeEach(() => {
  mockedMembership.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role: 'MEMBER' })),
  )
  mockedOptOutRepo.indexByWorkspace.mockResolvedValue(
    ok({ emails: new Set<string>(), personIds: new Set<string>() }),
  )
})

describe('CrmEmailCampaignService with visual-builder templates', () => {
  describe('create()', () => {
    it('renders the template once and caches html/text on the campaign', async () => {
      mockedRender.mockResolvedValueOnce(ok(BASE))
      mockedPersonRepo.listByWorkspace.mockResolvedValueOnce(
        ok([
          {
            id: 'p1',
            name: 'Ana',
            emails: ['ana@x.com'],
          } as never,
        ]),
      )
      const campaign = createFakeCrmEmailCampaign({ id: 'c1' })
      mockedCampaignRepo.create.mockResolvedValueOnce(ok(campaign))
      mockedRecipientRepo.createMany.mockResolvedValueOnce(ok(1))

      expectOk(
        await CrmEmailCampaignService.create('u1', 'ws1', {
          subject: 'Campanha',
          templateId: 't1',
          campaignLink: 'https://lp.com/?utm_source=email',
          fromAddress: 'crm@acme.com',
          recipientScope: 'ALL',
        }),
      )
      expect(mockedRender).toHaveBeenCalledWith('t1', 'ws1')
      expect(mockedCampaignRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          contentHtml: BASE.html,
          contentText: BASE.text,
          templateId: 't1',
          campaignLink: 'https://lp.com/?utm_source=email',
        }),
      )
    })

    it('propagates render failures without creating the campaign', async () => {
      mockedRender.mockResolvedValueOnce(err(notFound('CrmEmailTemplate')))
      mockedPersonRepo.listByWorkspace.mockResolvedValueOnce(
        ok([{ id: 'p1', name: 'Ana', emails: ['ana@x.com'] } as never]),
      )
      expectErr(
        await CrmEmailCampaignService.create('u1', 'ws1', {
          subject: 'Campanha',
          templateId: 'nope',
          fromAddress: 'crm@acme.com',
          recipientScope: 'ALL',
        }),
        'RESOURCE_NOT_FOUND',
      )
      expect(mockedCampaignRepo.create).not.toHaveBeenCalled()
    })
  })

  describe('send()', () => {
    function setupSend(overrides = {}) {
      const campaign = createFakeCrmEmailCampaign({
        id: 'c1',
        status: 'DRAFT',
        subject: BASE.subject,
        contentHtml: BASE.html,
        contentText: BASE.text,
        templateId: 't1',
        campaignLink: 'https://lp.com/?utm_source=email',
        ...overrides,
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
            email: 'maria@acme.com',
            name: 'Maria Souza',
            personId: 'p1',
          }),
          createFakeCrmEmailCampaignRecipient({
            id: 'r2',
            campaignId: 'c1',
            email: 'avulso@x.com',
            name: null,
            personId: null,
          }),
        ]),
      )
      mockedRecipientRepo.markSent.mockResolvedValue(ok(undefined))
      return campaign
    }

    it('personalizes each recipient and uses the inline unsubscribe link', async () => {
      setupSend()
      mockedBuilderRepo.findContacts.mockResolvedValueOnce(
        ok([
          {
            id: 'p1',
            name: 'Maria Souza',
            emails: ['maria@acme.com'],
            phones: [],
            city: null,
            jobTitle: null,
            companyName: 'Acme',
          },
        ]),
      )

      expectOk(await CrmEmailCampaignService.send('u1', 'ws1', 'c1'))

      expect(mockedBuilderRepo.findContacts).toHaveBeenCalledWith('ws1', ['p1'])
      expect(mockedSend).toHaveBeenCalledTimes(2)
      const first = mockedSend.mock.calls[0][0]
      expect(first.subject).toBe('Oi Maria')
      expect(first.html).toContain('<p>Oi Maria Souza da Acme</p>')
      expect(first.html).toContain('href="https://lp.com/?utm_source=email"')
      expect(first.html).toMatch(
        /href="[^"]*\/unsubscribe\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+"/,
      )
      // no second footer when the template already carries the link
      expect(first.html).not.toContain('Clique aqui para se descadastrar')
      expect(first.text).toContain('Oi Maria Souza https://lp.com/')
      expect(first.headers?.['List-Unsubscribe']).toBeDefined()

      const second = mockedSend.mock.calls[1][0]
      expect(second.subject).toBe('Oi cliente')
      expect(second.html).toContain('<p>Oi  da </p>')
    })

    it('still sends when the contact lookup fails (fields stay empty)', async () => {
      setupSend()
      mockedBuilderRepo.findContacts.mockResolvedValueOnce(
        err(databaseError('x')),
      )
      expectOk(await CrmEmailCampaignService.send('u1', 'ws1', 'c1'))
      expect(mockedSend.mock.calls[0][0].subject).toBe('Oi Maria')
    })

    it('keeps legacy html without variables untouched and appends the footer', async () => {
      setupSend({
        contentHtml: '<html><body><p>Oi</p></body></html>',
        contentText: null,
        templateId: null,
        campaignLink: null,
        subject: 'Promo',
      })
      expectOk(await CrmEmailCampaignService.send('u1', 'ws1', 'c1'))
      expect(mockedBuilderRepo.findContacts).not.toHaveBeenCalled()
      const first = mockedSend.mock.calls[0][0]
      expect(first.html).toContain('Clique aqui para se descadastrar')
      expect(first.text).toBeUndefined()
      expect(first.subject).toBe('Promo')
    })
  })
})
