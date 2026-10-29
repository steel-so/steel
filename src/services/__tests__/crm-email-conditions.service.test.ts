import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeCrmEmailBrand,
  createFakeCrmEmailCampaign,
  createFakeCrmEmailCampaignRecipient,
  createFakeCrmEmailCanvasTemplate,
} from '@/src/__tests__/factories/crm-email-marketing.factory'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { emailDocument } from '@/src/__tests__/helpers/email-canvas'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { encodeEmailCondition } from '@/src/lib/canvas-email/conditions'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/lib/env/server', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  BETTER_AUTH_URL: 'https://steel.test',
  BETTER_AUTH_SECRET: 'secret-for-tests-only-0123456789abcdef',
}))
vi.mock('@/lib/base-email-url', () => ({ baseEmailUrl: 'https://steel.test' }))
vi.mock('@/src/services/crm-notifications')
// ADR 0055 sender check: covered in crm-email-campaign.service.test.
vi.mock('@/src/lib/sending-domain/campaign-sender', () => ({
  checkCampaignSender: vi.fn(async () => ({
    ok: true,
    value: { platform: true },
  })),
}))
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/crm-email-template.repository')
vi.mock('@/src/repositories/crm-email-builder.repository')
vi.mock('@/src/repositories/crm-email-condition.repository')
vi.mock('@/src/repositories/crm-email-campaign.repository')
vi.mock('@/src/repositories/crm-person.repository')
vi.mock('@/src/repositories/crm-mailing-list.repository')
vi.mock('@/src/repositories/crm-email-opt-out.repository')
vi.mock('@/src/services/crm-email-template-history')
vi.mock('@/src/lib/mail/send', () => ({
  sendEmail: vi.fn(async () => ({ id: 'resend-1' })),
}))
vi.mock('@/src/lib/mail/client', () => ({
  defaultFrom: 'steel <suporte@stratustelecom.com.br>',
}))
vi.mock('@/src/services/media/crm-email-media.service', () => ({
  persistCrmEmailImage: vi.fn(),
}))

import { sendEmail } from '@/src/lib/mail/send'
import { CrmEmailBuilderRepository } from '@/src/repositories/crm-email-builder.repository'
import {
  CrmEmailCampaignRecipientRepository,
  CrmEmailCampaignRepository,
} from '@/src/repositories/crm-email-campaign.repository'
import { CrmEmailConditionRepository } from '@/src/repositories/crm-email-condition.repository'
import { CrmEmailOptOutRepository } from '@/src/repositories/crm-email-opt-out.repository'
import { CrmEmailTemplateRepository } from '@/src/repositories/crm-email-template.repository'
import { CrmPersonRepository } from '@/src/repositories/crm-person.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import {
  CrmEmailBuilderService,
  clearEmailRenderCache,
  renderCampaignEmail,
} from '../crm-email-builder.service'
import { CrmEmailCampaignService } from '../crm-email-campaign.service'
import { CrmEmailConditionService } from '../crm-email-condition.service'
import { snapshotTemplateVersion } from '../crm-email-template-history'

const membership = vi.mocked(MembershipRepository)
const templates = vi.mocked(CrmEmailTemplateRepository)
const builder = vi.mocked(CrmEmailBuilderRepository)
const conditions = vi.mocked(CrmEmailConditionRepository)
const campaigns = vi.mocked(CrmEmailCampaignRepository)
const recipients = vi.mocked(CrmEmailCampaignRecipientRepository)
const optOuts = vi.mocked(CrmEmailOptOutRepository)
const people = vi.mocked(CrmPersonRepository)
const snapshot = vi.mocked(snapshotTemplateVersion)
const send = vi.mocked(sendEmail)

const WS = 'ws1'

function conditionalTemplate() {
  const doc = emailDocument([
    [
      [
        {
          type: 'email.heading',
          props: {
            text: 'Oferta para Campinas',
            showIf: {
              kind: 'field',
              field: 'cidade',
              op: 'equals',
              value: 'Campinas',
            },
          },
        },
        {
          type: 'email.heading',
          id: 'vip',
          props: {
            text: 'Brinde VIP',
            showIf: { kind: 'list', op: 'in', listId: 'vip' },
          },
        },
        { type: 'email.heading', id: 'all', props: { text: 'Olá a todos' } },
      ],
    ],
  ])
  return createFakeCrmEmailCanvasTemplate('newsletter', {
    id: 't1',
    workspaceId: WS,
    subject: 'Oi',
    builderDocument: doc as never,
  })
}

beforeEach(() => {
  clearEmailRenderCache()
  membership.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role: 'MEMBER' })),
  )
  builder.findBrand.mockResolvedValue(
    ok(createFakeCrmEmailBrand({ workspaceId: WS })),
  )
  builder.findWorkspaceIdentity.mockResolvedValue(
    ok({ name: 'Acme', logoUrl: null }),
  )
  builder.findProducts.mockResolvedValue(ok([]))
  templates.findById.mockResolvedValue(ok(conditionalTemplate()))
  conditions.findListMemberships.mockResolvedValue(ok(new Map()))
})

describe('renderCampaignEmail() — "Mostrar se"', () => {
  it('shows each contact only what applies, loading list memberships once', async () => {
    conditions.findListMemberships.mockResolvedValueOnce(
      ok(new Map([['ana@x.com', ['vip']]])),
    )
    const email = expectOk(
      await renderCampaignEmail(
        't1',
        { email: 'Ana@x.com', city: 'Campinas' },
        { workspaceId: WS, personId: 'p1' },
      ),
    )
    expect(email.html).toContain('Oferta para Campinas')
    expect(email.html).toContain('Brinde VIP')
    expect(email.html).toContain('Olá a todos')
    expect(email.html).not.toContain('ec-if')
    expect(email.text).toContain('Brinde VIP')
    expect(conditions.findListMemberships).toHaveBeenCalledWith(WS, [
      { email: 'Ana@x.com', personId: 'p1' },
    ])
  })

  it('uses the lists the caller passes', async () => {
    const email = expectOk(
      await renderCampaignEmail(
        't1',
        { email: 'b@x.com', city: 'Santos' },
        { workspaceId: WS, listIds: [] },
      ),
    )
    expect(email.html).not.toContain('Oferta para Campinas')
    expect(email.html).not.toContain('Brinde VIP')
    expect(email.html).toContain('Olá a todos')
    expect(conditions.findListMemberships).not.toHaveBeenCalled()
  })

  it('treats an unknown contact as in no list', async () => {
    const email = expectOk(
      await renderCampaignEmail(
        't1',
        { email: 'c@x.com' },
        { workspaceId: WS },
      ),
    )
    expect(email.html).not.toContain('Brinde VIP')
  })

  it('does not look up lists without list conditions', async () => {
    const doc = emailDocument([
      [
        [
          {
            type: 'email.heading',
            props: {
              text: 'Sem empresa',
              showIf: {
                kind: 'field',
                field: 'empresa',
                op: 'empty',
                value: '',
              },
            },
          },
        ],
      ],
    ])
    templates.findById.mockResolvedValue(
      ok(
        createFakeCrmEmailCanvasTemplate('newsletter', {
          id: 't2',
          workspaceId: WS,
          builderDocument: doc as never,
        }),
      ),
    )
    const email = expectOk(
      await renderCampaignEmail(
        't2',
        { email: 'd@x.com' },
        { workspaceId: WS },
      ),
    )
    expect(email.html).toContain('Sem empresa')
    expect(conditions.findListMemberships).not.toHaveBeenCalled()
  })

  it('propagates a failed membership lookup', async () => {
    conditions.findListMemberships.mockResolvedValueOnce(
      err(databaseError('boom')),
    )
    expectErr(
      await renderCampaignEmail(
        't1',
        { email: 'e@x.com' },
        { workspaceId: WS },
      ),
      'DATABASE_ERROR',
    )
  })

  it('the preview render passes the CRM person', async () => {
    builder.findContacts.mockResolvedValueOnce(
      ok([
        {
          id: 'p9',
          name: 'Bia',
          emails: ['bia@x.com'],
          phones: [],
          city: 'Campinas',
          jobTitle: null,
          companyName: null,
        },
      ]),
    )
    const email = expectOk(
      await CrmEmailBuilderService.render('u1', WS, 't1', { personId: 'p9' }),
    )
    expect(email.html).toContain('Oferta para Campinas')
    expect(conditions.findListMemberships).toHaveBeenCalledWith(WS, [
      { email: 'bia@x.com', personId: 'p9' },
    ])
  })

  it('a test send records a version (best effort)', async () => {
    builder.findUserIdentity.mockResolvedValueOnce(
      ok({ email: 'me@acme.com', name: 'Eu' }),
    )
    expectOk(await CrmEmailBuilderService.testSend('u1', WS, 't1', {}))
    expect(snapshot).toHaveBeenCalledWith('t1', WS, 'u1', 'TEST_SEND')
  })
})

describe('CrmEmailCampaignService — "Mostrar se" per recipient', () => {
  const cond = (value: unknown) =>
    encodeEmailCondition(value as Parameters<typeof encodeEmailCondition>[0])
  const html = [
    '<html><body>',
    `<!--ec-if:a:${cond({ kind: 'field', field: 'cidade', op: 'equals', value: 'Campinas' })}--><p>Só Campinas</p><!--ec-endif:a-->`,
    `<!--ec-if:b:${cond({ kind: 'list', op: 'in', listId: 'vip' })}--><p>Só VIP</p><!--ec-endif:b-->`,
    '<p>Todos</p><a href="{{unsubscribe_url}}">Descadastrar</a></body></html>',
  ].join('')

  function setup(contentText: string | null) {
    const campaign = createFakeCrmEmailCampaign({
      id: 'c1',
      status: 'DRAFT',
      subject: 'Oi',
      contentHtml: html,
      contentText,
      templateId: 't1',
    })
    campaigns.findById.mockResolvedValue(ok(campaign))
    campaigns.setStatus.mockResolvedValue(ok({ ...campaign, status: 'SENT' }))
    recipients.listByCampaign.mockResolvedValue(
      ok([
        createFakeCrmEmailCampaignRecipient({
          id: 'r1',
          campaignId: 'c1',
          email: 'Maria@acme.com',
          name: 'Maria',
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
    recipients.markSent.mockResolvedValue(ok(undefined))
    optOuts.indexByWorkspace.mockResolvedValue(
      ok({ emails: new Set<string>(), personIds: new Set<string>() }),
    )
    builder.findContacts.mockResolvedValue(
      ok([
        {
          id: 'p1',
          name: 'Maria',
          emails: ['maria@acme.com'],
          phones: [],
          city: 'Campinas',
          jobTitle: null,
          companyName: null,
        },
      ]),
    )
  }

  it('evaluates field and list conditions for every recipient', async () => {
    setup('Só Campinas Só VIP Todos')
    conditions.findListMemberships.mockResolvedValueOnce(
      ok(new Map([['maria@acme.com', ['vip']]])),
    )
    expectOk(await CrmEmailCampaignService.send('u1', WS, 'c1'))
    expect(conditions.findListMemberships).toHaveBeenCalledWith(WS, [
      expect.objectContaining({ email: 'Maria@acme.com', personId: 'p1' }),
      expect.objectContaining({ email: 'avulso@x.com', personId: null }),
    ])
    const [maria, avulso] = send.mock.calls.map(([input]) => input)
    expect(maria.html).toContain('Só Campinas')
    expect(maria.html).toContain('Só VIP')
    expect(maria.text).toContain('Só VIP')
    expect(avulso.html).not.toContain('Só Campinas')
    expect(avulso.html).not.toContain('Só VIP')
    expect(avulso.html).toContain('Todos')
    expect(avulso.text).not.toContain('Só VIP')
  })

  it('degrades to "no lists" when the lookup fails and keeps no text when the campaign has none', async () => {
    setup(null)
    conditions.findListMemberships.mockResolvedValueOnce(
      err(databaseError('boom')),
    )
    expectOk(await CrmEmailCampaignService.send('u1', WS, 'c1'))
    const [maria] = send.mock.calls.map(([input]) => input)
    expect(maria.html).toContain('Só Campinas')
    expect(maria.html).not.toContain('Só VIP')
    expect(maria.text).toBeUndefined()
  })

  it('records a version when a campaign uses a template', async () => {
    people.listByWorkspace.mockResolvedValueOnce(
      ok([{ id: 'p1', name: 'Ana', emails: ['ana@x.com'] } as never]),
    )
    templates.findById.mockResolvedValue(ok(conditionalTemplate()))
    campaigns.create.mockResolvedValueOnce(
      ok(createFakeCrmEmailCampaign({ id: 'c2' })),
    )
    recipients.createMany.mockResolvedValueOnce(ok(1))
    expectOk(
      await CrmEmailCampaignService.create('u1', WS, {
        subject: 'Campanha',
        templateId: 't1',
        fromAddress: 'crm@acme.com',
        recipientScope: 'ALL',
      }),
    )
    expect(snapshot).toHaveBeenCalledWith('t1', WS, 'u1', 'CAMPAIGN')
  })
})

describe('CrmEmailConditionService.contactLists()', () => {
  it('returns the lists of a CRM person', async () => {
    conditions.findPersonListIds.mockResolvedValueOnce(ok(['l1']))
    expect(
      expectOk(await CrmEmailConditionService.contactLists('u1', WS, 'p1')),
    ).toEqual({ listIds: ['l1'] })
    expect(conditions.findPersonListIds).toHaveBeenCalledWith(WS, 'p1')
  })

  it('refuses non-members, unknown people and DB errors', async () => {
    membership.findByUserAndWorkspace.mockResolvedValueOnce(ok(null))
    expectErr(
      await CrmEmailConditionService.contactLists('u1', WS, 'p1'),
      'FORBIDDEN',
    )
    conditions.findPersonListIds.mockResolvedValueOnce(ok(null))
    expectErr(
      await CrmEmailConditionService.contactLists('u1', WS, 'p1'),
      'RESOURCE_NOT_FOUND',
    )
    conditions.findPersonListIds.mockResolvedValueOnce(
      err(databaseError('boom')),
    )
    expectErr(
      await CrmEmailConditionService.contactLists('u1', WS, 'p1'),
      'DATABASE_ERROR',
    )
  })
})
