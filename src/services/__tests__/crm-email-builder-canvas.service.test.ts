import { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeCrmEmailBrand,
  createFakeCrmEmailCanvasTemplate,
} from '@/src/__tests__/factories/crm-email-marketing.factory'
import { emailDocument } from '@/src/__tests__/helpers/email-canvas'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { crmEmailCanvasInvalid, databaseError } from '@/src/errors'
import { createEmailDocumentFromLayout } from '@/src/lib/canvas-email/convert-v1'
import { createBuilderDocument } from '@/src/lib/crm-email-builder/layouts'
import { err, ok } from '@/src/lib/result'
import type { EmailCanvasDocument } from '@/src/schemas/crm-email-builder.schema'

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

import { CrmEmailBuilderRepository } from '@/src/repositories/crm-email-builder.repository'
import { CrmEmailTemplateRepository } from '@/src/repositories/crm-email-template.repository'
import {
  buildBuilderTemplateContent,
  clearEmailRenderCache,
  renderCampaignEmail,
  renderTemplateForCampaign,
} from '../crm-email-builder.service'

const mockedTemplates = vi.mocked(CrmEmailTemplateRepository)
const mockedBuilder = vi.mocked(CrmEmailBuilderRepository)

const asV2 = (doc: unknown) => doc as EmailCanvasDocument

const product = {
  id: 'p1',
  name: 'Plano Pro',
  description: 'O plano completo',
  unitPrice: new Prisma.Decimal('1290.5'),
  currency: 'BRL',
}

beforeEach(() => {
  clearEmailRenderCache()
  mockedBuilder.findBrand.mockResolvedValue(
    ok(
      createFakeCrmEmailBrand({
        workspaceId: 'ws1',
        companyName: 'Acme',
        address: 'Rua das Flores, 10',
      }),
    ),
  )
  mockedBuilder.findWorkspaceIdentity.mockResolvedValue(
    ok({ name: 'Acme WS', logoUrl: null }),
  )
  mockedBuilder.findProducts.mockResolvedValue(ok([]))
})

describe('buildBuilderTemplateContent() with a v2 document', () => {
  it('validates, sanitizes and renders with the catalog components', async () => {
    const doc = emailDocument([
      [
        [
          {
            type: 'email.text',
            props: { html: '<p>Olá {{primeiro_nome}}<script>x</script></p>' },
          },
        ],
      ],
    ])
    doc.nodes.root.children = ['footer', 's0']
    const built = expectOk(
      await buildBuilderTemplateContent('ws1', asV2(doc), 'Assunto'),
    )
    const stored = built.document as unknown as typeof doc
    expect(stored.nodes.root.children).toEqual(['s0', 'footer'])
    expect(stored.nodes.b0.props.html).toBe('<p>Olá {{primeiro_nome}}</p>')
    expect(built.html).toContain('Olá {{primeiro_nome}}')
    expect(built.html).toContain('{{unsubscribe_url}}')
    expect(built.html).not.toContain('data-canvas-id')
    expect(built.text).toContain('Olá {{primeiro_nome}}')
    expect(mockedBuilder.findProducts).toHaveBeenCalledWith('ws1', [])
  })

  it('refuses an invalid document with every issue', async () => {
    const doc = emailDocument()
    delete (doc.nodes as Record<string, unknown>).footer
    doc.nodes.root.children = ['s0']
    const error = expectErr(
      await buildBuilderTemplateContent('ws1', asV2(doc), 'x'),
      'CRM_EMAIL_CANVAS_INVALID',
    )
    expect(error.message).toBe('O e-mail precisa de "Rodapé"')
    expect(error.details).toEqual({ issues: ['O e-mail precisa de "Rodapé"'] })
  })

  it('lets only admins add or change HTML blocks', async () => {
    const withHtml = emailDocument([[[{ type: 'email.html', id: 'h' }]]])
    expectErr(
      await buildBuilderTemplateContent('ws1', asV2(withHtml), 'x'),
      'CRM_EMAIL_CANVAS_HTML_FORBIDDEN',
    )
    expectErr(
      await buildBuilderTemplateContent('ws1', asV2(withHtml), 'x', {
        previous: createBuilderDocument('newsletter'),
      }),
      'CRM_EMAIL_CANVAS_HTML_FORBIDDEN',
    )
    expectOk(
      await buildBuilderTemplateContent('ws1', asV2(withHtml), 'x', {
        privileged: true,
      }),
    )
    // A member may edit the rest of a document an admin added HTML to.
    const edited = structuredClone(withHtml)
    edited.nodes.footer.props.note = 'Nova nota'
    expectOk(
      await buildBuilderTemplateContent('ws1', asV2(edited), 'x', {
        previous: withHtml,
      }),
    )
  })

  it('fills product blocks from the CRM', async () => {
    mockedBuilder.findProducts.mockResolvedValueOnce(ok([product]))
    const doc = emailDocument([
      [[{ type: 'email.product', props: { productId: 'p1' } }]],
    ])
    const built = expectOk(
      await buildBuilderTemplateContent('ws1', asV2(doc), 'x'),
    )
    expect(mockedBuilder.findProducts).toHaveBeenCalledWith('ws1', ['p1'])
    expect(built.html).toContain('Plano Pro')
    expect(built.html).toMatch(/R\$\s1\.290,50/)
  })

  it('propagates repository failures', async () => {
    const doc = emailDocument()
    mockedBuilder.findProducts.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await buildBuilderTemplateContent('ws1', asV2(doc), 'x'),
      'DATABASE_ERROR',
    )
    mockedBuilder.findBrand.mockResolvedValueOnce(err(databaseError('x')))
    expectErr(
      await buildBuilderTemplateContent('ws1', asV2(doc), 'x'),
      'DATABASE_ERROR',
    )
  })
})

describe('campaign render of a v2 template', () => {
  const template = () =>
    createFakeCrmEmailCanvasTemplate('promocao', {
      id: 't1',
      workspaceId: 'ws1',
      subject: 'Oi {{primeiro_nome|cliente}}',
      updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    })

  it('renders through the catalog and personalizes per contact', async () => {
    mockedTemplates.findById.mockResolvedValueOnce(ok(template()))
    const email = expectOk(
      await renderCampaignEmail(
        't1',
        { email: 'joao@x.com', name: 'João Lima' },
        {
          workspaceId: 'ws1',
          campaignLink: 'https://acme.com.br/lp?utm_source=email',
          unsubscribeUrl: 'https://steel.test/unsubscribe/tok',
        },
      ),
    )
    expect(email.subject).toBe('Oi João')
    expect(email.html).toContain(
      'href="https://acme.com.br/lp?utm_source=email"',
    )
    expect(email.html).toContain('href="https://steel.test/unsubscribe/tok"')
    // (`}}` closes the media query in the <style>.)
    expect(email.html).not.toContain('{{')
    expect(email.html).not.toContain('data-canvas-id')
    expect(email.html).toContain('ec-container')
  })

  it('caches the base render per template version, brand and products', async () => {
    mockedTemplates.findById.mockResolvedValue(ok(template()))
    const first = expectOk(await renderTemplateForCampaign('t1', 'ws1'))
    const second = expectOk(await renderTemplateForCampaign('t1', 'ws1'))
    expect(second).toBe(first)
    mockedBuilder.findProducts.mockResolvedValueOnce(ok([product]))
    const third = expectOk(await renderTemplateForCampaign('t1', 'ws1'))
    expect(third).not.toBe(first)
    mockedTemplates.findById.mockReset()
  })

  it('refuses a stored v2 document that no longer validates', async () => {
    const broken = createEmailDocumentFromLayout('promocao')
    broken.nodes.root.children = []
    mockedTemplates.findById.mockResolvedValueOnce(
      ok(
        createFakeCrmEmailCanvasTemplate('promocao', {
          id: 't2',
          builderDocument: broken as unknown as Prisma.JsonObject,
        }),
      ),
    )
    expectErr(
      await renderTemplateForCampaign('t2', 'ws1'),
      'CRM_EMAIL_CANVAS_INVALID',
    )
  })
})

describe('crmEmailCanvasInvalid()', () => {
  it('uses the first issue as the message, or a generic one', () => {
    expect(crmEmailCanvasInvalid(['A', 'B'])).toEqual({
      code: 'CRM_EMAIL_CANVAS_INVALID',
      message: 'A',
      details: { issues: ['A', 'B'] },
    })
    expect(crmEmailCanvasInvalid([]).message).toBe(
      'O conteúdo do e-mail é inválido',
    )
  })
})
