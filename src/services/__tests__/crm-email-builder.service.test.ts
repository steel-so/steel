import type { Role } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeCrmEmailBrand,
  createFakeCrmEmailBuilderTemplate,
  createFakeCrmEmailTemplate,
} from '@/src/__tests__/factories/crm-email-marketing.factory'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, notFound, storageError } from '@/src/errors'
import {
  createBuilderDocument,
  EMAIL_LAYOUT_LIST,
} from '@/src/lib/crm-email-builder/layouts'
import { err, ok } from '@/src/lib/result'
import type { EmailBuilderDocument } from '@/src/schemas/crm-email-builder.schema'

vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/lib/env/server', () => ({
  BETTER_AUTH_URL: 'https://steel.test',
  BETTER_AUTH_SECRET: 'secret-for-tests-only-0123456789abcdef',
}))
vi.mock('@/lib/base-email-url', () => ({ baseEmailUrl: 'https://steel.test' }))
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/crm-email-template.repository')
vi.mock('@/src/repositories/crm-email-builder.repository')
vi.mock('@/src/lib/mail/send', () => ({ sendEmail: vi.fn() }))
vi.mock('@/src/lib/mail/client', () => ({
  defaultFrom: 'steel <suporte@stratustelecom.com.br>',
}))
vi.mock('@/src/services/media/crm-email-media.service', () => ({
  persistCrmEmailImage: vi.fn(),
}))

import { auditMutation } from '@/lib/axiom/audit'
import { sendEmail } from '@/src/lib/mail/send'
import { CrmEmailBuilderRepository } from '@/src/repositories/crm-email-builder.repository'
import { CrmEmailTemplateRepository } from '@/src/repositories/crm-email-template.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { persistCrmEmailImage } from '@/src/services/media/crm-email-media.service'
import {
  buildBuilderTemplateContent,
  CrmEmailBuilderService,
  clearEmailRenderCache,
  renderCampaignEmail,
} from '../crm-email-builder.service'

const mockedMembership = vi.mocked(MembershipRepository)
const mockedModuleAccess = vi.mocked(WorkspaceModuleAccessRepository)
const mockedTemplates = vi.mocked(CrmEmailTemplateRepository)
const mockedBuilder = vi.mocked(CrmEmailBuilderRepository)
const mockedSend = vi.mocked(sendEmail)
const mockedAudit = vi.mocked(auditMutation)
const mockedPersist = vi.mocked(persistCrmEmailImage)

function asRole(role: Role) {
  mockedMembership.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )
}

const contact = {
  email: 'joao@cliente.com',
  name: 'João Lima',
  company: 'Lima & Filhos',
  jobTitle: 'Diretor',
  phone: '(21) 3333-4444',
  city: 'Rio de Janeiro',
}

function builderTemplate(layout = EMAIL_LAYOUT_LIST[0].id) {
  return createFakeCrmEmailBuilderTemplate(layout, {
    id: `t-${layout}`,
    workspaceId: 'ws1',
    subject: 'Oi {{primeiro_nome|cliente}}',
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
  })
}

beforeEach(() => {
  clearEmailRenderCache()
  mockedBuilder.findBrand.mockResolvedValue(
    ok(
      createFakeCrmEmailBrand({
        workspaceId: 'ws1',
        companyName: 'Acme',
        address: 'Rua das Flores, 10',
        website: 'https://acme.com.br',
      }),
    ),
  )
  mockedBuilder.findWorkspaceIdentity.mockResolvedValue(
    ok({ name: 'Acme WS', logoUrl: null }),
  )
})

describe('renderCampaignEmail()', () => {
  it.each(EMAIL_LAYOUT_LIST.map((l) => [l.id]))(
    'renders the %s layout for a contact (snapshot)',
    async (layout) => {
      mockedTemplates.findById.mockResolvedValueOnce(
        ok(builderTemplate(layout)),
      )
      const email = expectOk(
        await renderCampaignEmail(`t-${layout}`, contact, {
          workspaceId: 'ws1',
          campaignLink: 'https://acme.com.br/lp?utm_source=email',
          unsubscribeUrl: 'https://steel.test/unsubscribe/tok',
        }),
      )
      expect(email.subject).toBe('Oi João')
      expect(email.html).toContain('href="https://steel.test/unsubscribe/tok"')
      expect(email.html).not.toMatch(/\{\{|\}\}/)
      expect(email.text).not.toMatch(/\{\{|\}\}/)
      expect(email.html).toMatchSnapshot('html')
      expect(email.text).toMatchSnapshot('text')
    },
  )

  it('resolves the campaign link and the contact variables', async () => {
    mockedTemplates.findById.mockResolvedValueOnce(
      ok(builderTemplate('follow-up-proposta')),
    )
    const email = expectOk(
      await renderCampaignEmail('t-follow-up-proposta', contact, {
        workspaceId: 'ws1',
        campaignLink: 'https://acme.com.br/lp?utm_source=email',
      }),
    )
    expect(email.html).toContain(
      'href="https://acme.com.br/lp?utm_source=email"',
    )
    expect(email.html).toContain('Lima &amp; Filhos')
    expect(email.text).toContain('Lima & Filhos')
  })

  it('always carries an unsubscribe link: signed from the recipient id', async () => {
    mockedTemplates.findById.mockResolvedValueOnce(ok(builderTemplate()))
    const email = expectOk(
      await renderCampaignEmail('t-newsletter', contact, {
        workspaceId: 'ws1',
        recipientId: 'rcpt-1',
      }),
    )
    expect(email.html).toMatch(
      /href="https:\/\/steel\.test\/unsubscribe\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+"/,
    )
  })

  it('falls back to the generic unsubscribe page when no recipient is given', async () => {
    mockedTemplates.findById.mockResolvedValueOnce(ok(builderTemplate()))
    const email = expectOk(
      await renderCampaignEmail('t-newsletter', contact, {
        workspaceId: 'ws1',
      }),
    )
    expect(email.html).toContain('href="https://steel.test/unsubscribe/teste"')
  })

  it('reuses the base render for the same template version (cache)', async () => {
    const template = builderTemplate()
    mockedTemplates.findById.mockResolvedValue(ok(template))
    const first = expectOk(
      await renderCampaignEmail(template.id, contact, { workspaceId: 'ws1' }),
    )
    const second = expectOk(
      await renderCampaignEmail(
        template.id,
        { ...contact, name: 'Ana' },
        { workspaceId: 'ws1' },
      ),
    )
    expect(first.subject).toBe('Oi João')
    expect(second.subject).toBe('Oi Ana')
  })

  it('renders a legacy template from its stored HTML with the footer appended', async () => {
    mockedTemplates.findById.mockResolvedValueOnce(
      ok(
        createFakeCrmEmailTemplate({
          workspaceId: 'ws1',
          subject: 'Olá {{nome}}',
          contentHtml: '<html><body><p>Oi {{primeiro_nome}}</p></body></html>',
        }),
      ),
    )
    const email = expectOk(
      await renderCampaignEmail('legacy', contact, {
        workspaceId: 'ws1',
        unsubscribeUrl: 'https://u/1',
      }),
    )
    expect(email.subject).toBe('Olá João Lima')
    expect(email.html).toContain('<p>Oi João</p>')
    expect(email.html).toContain('href="https://u/1"')
    expect(email.text).toContain('Oi João')
  })

  it('keeps a legacy template that already carries the unsubscribe link and text', async () => {
    mockedTemplates.findById.mockResolvedValueOnce(
      ok(
        createFakeCrmEmailTemplate({
          workspaceId: 'ws1',
          contentHtml: '<p>Oi</p><a href="{{unsubscribe_url}}">sair</a>',
          contentText: 'Oi {{nome}} sair {{unsubscribe_url}}',
        }),
      ),
    )
    const email = expectOk(
      await renderCampaignEmail('legacy', contact, {
        workspaceId: 'ws1',
        unsubscribeUrl: 'https://u/2',
      }),
    )
    expect(email.html).not.toContain('Clique aqui para se descadastrar')
    expect(email.text).toBe('Oi João Lima sair https://u/2')
  })

  it('evicts the oldest base render past the cache limit', async () => {
    for (let i = 0; i < 205; i += 1) {
      mockedTemplates.findById.mockResolvedValueOnce(
        ok(
          createFakeCrmEmailBuilderTemplate('follow-up-proposta', {
            id: 't-cache',
            workspaceId: 'ws1',
            subject: `Versão ${i}`,
            updatedAt: new Date(2026, 0, 1, 0, 0, i),
          }),
        ),
      )
      const email = expectOk(
        await renderCampaignEmail('t-cache', contact, { workspaceId: 'ws1' }),
      )
      expect(email.subject).toBe(`Versão ${i}`)
    }
  })

  it('propagates NOT_FOUND for a template of another workspace', async () => {
    mockedTemplates.findById.mockResolvedValueOnce(
      err(notFound('CrmEmailTemplate')),
    )
    expectErr(
      await renderCampaignEmail('t', contact, { workspaceId: 'ws1' }),
      'RESOURCE_NOT_FOUND',
    )
  })

  it('propagates brand lookup failures', async () => {
    mockedTemplates.findById.mockResolvedValueOnce(ok(builderTemplate()))
    mockedBuilder.findBrand.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await renderCampaignEmail('t', contact, { workspaceId: 'ws1' }),
      'DATABASE_ERROR',
    )
    mockedTemplates.findById.mockResolvedValueOnce(ok(builderTemplate()))
    mockedBuilder.findWorkspaceIdentity.mockResolvedValueOnce(
      err(notFound('Workspace')),
    )
    expectErr(
      await renderCampaignEmail('t', contact, { workspaceId: 'ws1' }),
      'RESOURCE_NOT_FOUND',
    )
  })

  it('rejects a stored document that no longer parses', async () => {
    mockedTemplates.findById.mockResolvedValueOnce(
      ok(
        createFakeCrmEmailBuilderTemplate('newsletter', {
          workspaceId: 'ws1',
          builderDocument: { version: 99 },
        }),
      ),
    )
    expectErr(
      await renderCampaignEmail('t', contact, { workspaceId: 'ws1' }),
      'CRM_EMAIL_BUILDER_STRUCTURE_LOCKED',
    )
  })
})

describe('buildBuilderTemplateContent()', () => {
  it('sanitizes rich text and renders html + text with variables intact', async () => {
    const doc = createBuilderDocument('newsletter')
    const dirty: EmailBuilderDocument = {
      ...doc,
      sections: doc.sections.map((s) =>
        s.type === 'text'
          ? {
              ...s,
              props: {
                ...s.props,
                body: '<p onclick="x()">Oi {{nome}}<script>alert(1)</script></p>',
              },
            }
          : s,
      ),
    }
    const built = expectOk(
      await buildBuilderTemplateContent('ws1', dirty, 'Assunto'),
    )
    const intro = (built.document as EmailBuilderDocument).sections.find(
      (s) => s.id === 'intro',
    )
    expect(intro?.type === 'text' && intro.props.body).toBe(
      '<p>Oi {{nome}}</p>',
    )
    expect(built.html).toContain('{{unsubscribe_url}}')
    expect(built.html).not.toContain('<script>')
    expect(built.text).toContain('Oi {{nome}}')
  })

  it('rejects a document that breaks the locked structure', async () => {
    const doc = createBuilderDocument('newsletter')
    expectErr(
      await buildBuilderTemplateContent(
        'ws1',
        { ...doc, sections: doc.sections.slice(0, -1) },
        'Assunto',
      ),
      'CRM_EMAIL_BUILDER_STRUCTURE_LOCKED',
    )
  })
})

describe('CrmEmailBuilderService', () => {
  describe('authorization', () => {
    it('returns FORBIDDEN for a non-member', async () => {
      mockedMembership.findByUserAndWorkspace.mockResolvedValue(ok(null))
      expectErr(await CrmEmailBuilderService.getBrand('u1', 'ws1'), 'FORBIDDEN')
    })

    it('returns MODULE_DISABLED when the CRM is off', async () => {
      asRole('OWNER')
      mockedModuleAccess.isEnabled.mockResolvedValueOnce(ok(false))
      expectErr(
        await CrmEmailBuilderService.linkTargets('u1', 'ws1'),
        'MODULE_DISABLED',
      )
    })

    it.each([
      [
        'updateBrand',
        () =>
          CrmEmailBuilderService.updateBrand('u1', 'ws1', {
            companyName: 'X',
            logoUrl: '',
            primaryColor: '#000000',
            address: '',
            website: '',
          }),
      ],
      [
        'testSend',
        () => CrmEmailBuilderService.testSend('u1', 'ws1', 't1', {}),
      ],
      [
        'uploadImage',
        () =>
          CrmEmailBuilderService.uploadImage('u1', 'ws1', {
            contentType: 'image/png',
            byteSize: 10,
            readBody: async () => Buffer.from('x'),
          }),
      ],
    ])('forbids a VIEWER from %s', async (_name, call) => {
      asRole('VIEWER')
      expectErr(await call(), 'FORBIDDEN')
      expect(mockedSend).not.toHaveBeenCalled()
      expect(mockedPersist).not.toHaveBeenCalled()
      expect(mockedBuilder.upsertBrand).not.toHaveBeenCalled()
    })
  })

  describe('getBrand() / updateBrand()', () => {
    it('returns the saved brand', async () => {
      asRole('MEMBER')
      const dto = expectOk(await CrmEmailBuilderService.getBrand('u1', 'ws1'))
      expect(dto).toMatchObject({ companyName: 'Acme', saved: true })
    })

    it('falls back to the workspace identity when nothing is saved', async () => {
      asRole('MEMBER')
      mockedBuilder.findBrand.mockResolvedValueOnce(ok(null))
      const dto = expectOk(await CrmEmailBuilderService.getBrand('u1', 'ws1'))
      expect(dto).toMatchObject({
        companyName: 'Acme WS',
        primaryColor: '#2893CC',
        saved: false,
      })
    })

    it('propagates repository errors', async () => {
      asRole('MEMBER')
      mockedBuilder.findBrand.mockResolvedValueOnce(err(databaseError('x')))
      expectErr(
        await CrmEmailBuilderService.getBrand('u1', 'ws1'),
        'DATABASE_ERROR',
      )
    })

    it('saves the brand and audits it', async () => {
      asRole('ADMIN')
      const input = {
        companyName: 'Nova',
        logoUrl: 'https://cdn/l.png',
        primaryColor: '#123456',
        address: 'Rua B',
        website: 'https://nova.com',
      }
      mockedBuilder.upsertBrand.mockResolvedValueOnce(
        ok(createFakeCrmEmailBrand({ ...input, workspaceId: 'ws1' })),
      )
      const dto = expectOk(
        await CrmEmailBuilderService.updateBrand('u1', 'ws1', input),
      )
      expect(dto).toMatchObject({ ...input, saved: true })
      expect(mockedBuilder.upsertBrand).toHaveBeenCalledWith('ws1', input, 'u1')
      expect(mockedAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: 'crm_email_brand',
          action: 'update',
        }),
      )
    })

    it('propagates save failures', async () => {
      asRole('ADMIN')
      mockedBuilder.upsertBrand.mockResolvedValueOnce(err(databaseError('x')))
      expectErr(
        await CrmEmailBuilderService.updateBrand('u1', 'ws1', {
          companyName: 'X',
          logoUrl: '',
          primaryColor: '#000000',
          address: '',
          website: '',
        }),
        'DATABASE_ERROR',
      )
    })
  })

  describe('render()', () => {
    it('renders with the sample contact by default', async () => {
      asRole('VIEWER')
      mockedTemplates.findById.mockResolvedValueOnce(ok(builderTemplate()))
      const email = expectOk(
        await CrmEmailBuilderService.render('u1', 'ws1', 't-newsletter', {}),
      )
      expect(email.subject).toBe('Oi Maria')
    })

    it('renders with an inline sample and a campaign link', async () => {
      asRole('VIEWER')
      mockedTemplates.findById.mockResolvedValueOnce(ok(builderTemplate()))
      const email = expectOk(
        await CrmEmailBuilderService.render('u1', 'ws1', 't-newsletter', {
          sample: { email: 'x@y.com', name: 'Zé' },
          campaignLink: 'https://lp.com',
        }),
      )
      expect(email.subject).toBe('Oi Zé')
      expect(email.html).toContain('href="https://lp.com"')
    })

    it('renders with a CRM person of the workspace', async () => {
      asRole('VIEWER')
      mockedTemplates.findById.mockResolvedValueOnce(ok(builderTemplate()))
      mockedBuilder.findContacts.mockResolvedValueOnce(
        ok([
          {
            id: 'p1',
            name: 'Carla Dias',
            emails: ['carla@x.com'],
            phones: [],
            city: null,
            jobTitle: null,
            companyName: null,
          },
        ]),
      )
      const email = expectOk(
        await CrmEmailBuilderService.render('u1', 'ws1', 't-newsletter', {
          personId: 'p1',
        }),
      )
      expect(email.subject).toBe('Oi Carla')
      expect(mockedBuilder.findContacts).toHaveBeenCalledWith('ws1', ['p1'])
    })

    it('returns NOT_FOUND for a person outside the workspace', async () => {
      asRole('VIEWER')
      mockedBuilder.findContacts.mockResolvedValueOnce(ok([]))
      expectErr(
        await CrmEmailBuilderService.render('u1', 'ws1', 't', {
          personId: 'p-other',
        }),
        'RESOURCE_NOT_FOUND',
      )
    })

    it('propagates person lookup failures', async () => {
      asRole('VIEWER')
      mockedBuilder.findContacts.mockResolvedValueOnce(err(databaseError('x')))
      expectErr(
        await CrmEmailBuilderService.render('u1', 'ws1', 't', {
          personId: 'p1',
        }),
        'DATABASE_ERROR',
      )
    })
  })

  describe('testSend()', () => {
    it('sends the personalized test to the actor and audits it', async () => {
      asRole('MEMBER')
      mockedTemplates.findById.mockResolvedValueOnce(ok(builderTemplate()))
      mockedBuilder.findUserIdentity.mockResolvedValueOnce(
        ok({ email: 'me@acme.com', name: 'Eu' }),
      )
      mockedSend.mockResolvedValueOnce({ id: 'msg-1' })
      const result = expectOk(
        await CrmEmailBuilderService.testSend('u1', 'ws1', 't-newsletter', {}),
      )
      expect(result).toEqual({ to: 'me@acme.com' })
      const sent = mockedSend.mock.calls[0][0]
      expect(sent.to).toBe('me@acme.com')
      expect(sent.subject).toBe('[Teste] Oi Maria')
      expect(sent.html).toContain('/unsubscribe/teste')
      expect(sent.text).toContain('Descadastrar')
      expect(mockedAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: 'crm_email_template',
          action: 'test',
        }),
      )
    })

    it('returns MAIL_ERROR when the provider fails', async () => {
      asRole('MEMBER')
      mockedTemplates.findById.mockResolvedValueOnce(ok(builderTemplate()))
      mockedBuilder.findUserIdentity.mockResolvedValueOnce(
        ok({ email: 'me@acme.com', name: 'Eu' }),
      )
      mockedSend.mockRejectedValueOnce(new Error('resend down'))
      expectErr(
        await CrmEmailBuilderService.testSend('u1', 'ws1', 't-newsletter', {}),
        'MAIL_ERROR',
      )
    })

    it('propagates render and user lookup failures', async () => {
      asRole('MEMBER')
      mockedBuilder.findUserIdentity.mockResolvedValueOnce(
        err(notFound('User')),
      )
      expectErr(
        await CrmEmailBuilderService.testSend('u1', 'ws1', 't', {}),
        'RESOURCE_NOT_FOUND',
      )
      mockedBuilder.findUserIdentity.mockResolvedValueOnce(
        ok({ email: 'me@acme.com', name: 'Eu' }),
      )
      mockedTemplates.findById.mockResolvedValueOnce(
        err(notFound('CrmEmailTemplate')),
      )
      expectErr(
        await CrmEmailBuilderService.testSend('u1', 'ws1', 't', {}),
        'RESOURCE_NOT_FOUND',
      )
    })
  })

  describe('edge cases', () => {
    it('returns FORBIDDEN when a non-member renders', async () => {
      mockedMembership.findByUserAndWorkspace.mockResolvedValue(ok(null))
      expectErr(
        await CrmEmailBuilderService.render('u1', 'ws1', 't1', {}),
        'FORBIDDEN',
      )
    })

    it('stops the test send when the person is not found', async () => {
      asRole('MEMBER')
      mockedBuilder.findUserIdentity.mockResolvedValueOnce(
        ok({ email: 'me@acme.com', name: 'Eu' }),
      )
      mockedBuilder.findContacts.mockResolvedValueOnce(ok([]))
      expectErr(
        await CrmEmailBuilderService.testSend('u1', 'ws1', 't1', {
          personId: 'p-x',
        }),
        'RESOURCE_NOT_FOUND',
      )
      expect(mockedSend).not.toHaveBeenCalled()
    })

    it('maps a non-Error provider failure to MAIL_ERROR', async () => {
      asRole('MEMBER')
      mockedTemplates.findById.mockResolvedValueOnce(ok(builderTemplate()))
      mockedBuilder.findUserIdentity.mockResolvedValueOnce(
        ok({ email: 'me@acme.com', name: 'Eu' }),
      )
      mockedSend.mockRejectedValueOnce('timeout')
      expectErr(
        await CrmEmailBuilderService.testSend('u1', 'ws1', 't-newsletter', {}),
        'MAIL_ERROR',
      )
    })
  })

  describe('linkTargets()', () => {
    it('lists published landing pages and forms with public URLs', async () => {
      asRole('VIEWER')
      mockedBuilder.listPublishedLinkTargets.mockResolvedValueOnce(
        ok({
          landingPages: [{ id: 'l1', title: 'Promo', shareToken: 'tok' }],
          forms: [{ id: 'f1', name: 'Contato', publicToken: 'ft' }],
        }),
      )
      expect(
        expectOk(await CrmEmailBuilderService.linkTargets('u1', 'ws1')),
      ).toEqual({
        landingPages: [
          { id: 'l1', title: 'Promo', url: 'https://steel.test/l/tok' },
        ],
        forms: [{ id: 'f1', name: 'Contato', url: 'https://steel.test/f/ft' }],
      })
    })

    it('propagates repository errors', async () => {
      asRole('VIEWER')
      mockedBuilder.listPublishedLinkTargets.mockResolvedValueOnce(
        err(databaseError('x')),
      )
      expectErr(
        await CrmEmailBuilderService.linkTargets('u1', 'ws1'),
        'DATABASE_ERROR',
      )
    })
  })

  describe('uploadImage()', () => {
    it('stores the image and audits it', async () => {
      asRole('MEMBER')
      mockedPersist.mockResolvedValueOnce(ok({ url: 'https://cdn/x.png' }))
      const input = {
        contentType: 'image/png',
        byteSize: 10,
        readBody: async () => Buffer.from('x'),
      }
      expect(
        expectOk(await CrmEmailBuilderService.uploadImage('u1', 'ws1', input)),
      ).toEqual({ url: 'https://cdn/x.png' })
      expect(mockedPersist).toHaveBeenCalledWith({
        workspaceId: 'ws1',
        ...input,
      })
    })

    it('propagates storage failures', async () => {
      asRole('MEMBER')
      mockedPersist.mockResolvedValueOnce(err(storageError('x')))
      expectErr(
        await CrmEmailBuilderService.uploadImage('u1', 'ws1', {
          contentType: 'image/png',
          byteSize: 10,
          readBody: async () => Buffer.from('x'),
        }),
        'STORAGE_ERROR',
      )
    })
  })
})
