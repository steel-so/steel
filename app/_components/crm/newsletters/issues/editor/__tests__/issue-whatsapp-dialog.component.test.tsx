import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/src/__tests__/helpers/component'
import { jsonResponse, mockFetch } from '@/src/__tests__/helpers/fetch.helpers'
import type { CrmNewsletterIssueWhatsAppDTO } from '@/src/schemas/crm-newsletter-engage.schema'
import type {
  CrmCampaignOptionsDTO,
  CrmCampaignWhatsAppTemplateOptionDTO,
} from '@/types/crm-campaign'
import {
  type IssueEditorContext,
  IssueEditorProvider,
} from '../issue-editor-context'
import {
  defaultVariables,
  IssueWhatsAppButton,
  templateSlots,
} from '../issue-whatsapp-dialog'

vi.mock('@/lib/notify', () => ({
  notify: { success: vi.fn(), error: vi.fn() },
}))

const CONTEXT: IssueEditorContext = {
  workspaceId: 'ws1',
  slug: 'acme',
  newsletterId: 'nl1',
  issueId: 'is1',
  initialSlug: 'edicao',
  status: 'DRAFT',
  scheduledAt: null,
  senderVerified: true,
  save: vi.fn(),
}

const TEMPLATE: CrmCampaignWhatsAppTemplateOptionDTO = {
  id: 't1',
  name: 'nova_edicao',
  language: 'pt_BR',
  category: 'MARKETING',
  status: 'APPROVED',
  quality: 'GREEN',
  headerFormat: null,
  headerMediaUrl: null,
  buttons: [
    {
      type: 'URL',
      label: 'Ler',
      url: 'https://x/{{1}}',
      dynamic: true,
      actionCount: 0,
    },
  ],
  blockedReason: null,
  fields: {
    headerVariables: 1,
    bodyVariables: 5,
    bodyText: 'Oi {{1}}, saiu {{2}}',
    urlButtons: [0],
  },
}

const OPTIONS = {
  whatsapp: {
    available: true,
    reason: null,
    quickReplies: [],
    connections: [
      {
        id: 'cz',
        label: 'Suporte',
        provider: 'ZAPI',
        phoneNumber: '+5511999990000',
        templates: [],
      },
      {
        id: 'cm',
        label: 'Marketing',
        provider: 'META',
        phoneNumber: '+5511888880000',
        templates: [TEMPLATE],
      },
    ],
  },
} as unknown as CrmCampaignOptionsDTO

function dtoOf(
  over: Partial<CrmNewsletterIssueWhatsAppDTO> = {},
): CrmNewsletterIssueWhatsAppDTO {
  return {
    issueId: 'is1',
    enabled: false,
    connectionId: 'cz',
    templateId: null,
    variables: null,
    text: null,
    legalBasis: 'CONSENT',
    consentConfirmedAt: null,
    startedAt: null,
    available: true,
    unavailableReason: null,
    problems: [],
    reach: { linked: 3, reachable: 2, missingPhone: 1, optedOut: 0 },
    ...over,
  }
}

function setup(dto: CrmNewsletterIssueWhatsAppDTO, saved = dto) {
  const fetch = mockFetch((url, init) => {
    if (url.endsWith('/options')) {
      return jsonResponse({ success: true, data: OPTIONS })
    }
    if (init?.method === 'PATCH') {
      return jsonResponse({ success: true, data: saved })
    }
    return jsonResponse({ success: true, data: dto })
  })
  const view = renderWithProviders(
    <IssueEditorProvider value={CONTEXT}>
      <IssueWhatsAppButton />
    </IssueEditorProvider>,
  )
  return { ...view, fetch }
}

describe('issue WhatsApp dialog helpers', () => {
  it('lists the template slots and maps them by default', () => {
    expect(templateSlots(TEMPLATE).map((slot) => slot.label)).toEqual([
      'Cabeçalho {{1}}',
      'Mensagem {{1}}',
      'Mensagem {{2}}',
      'Mensagem {{3}}',
      'Mensagem {{4}}',
      'Mensagem {{5}}',
      'Botão “Ler” (fim da URL)',
    ])
    expect(
      templateSlots({
        ...TEMPLATE,
        buttons: [],
        fields: { ...TEMPLATE.fields, urlButtons: [3] },
      }).at(-1)?.label,
    ).toBe('Botão “4” (fim da URL)')
    expect(defaultVariables(TEMPLATE)).toEqual({
      header: {},
      body: {
        '1': { source: 'first_name' },
        '2': { source: 'subject' },
        '3': { source: 'summary' },
        '4': { source: 'link' },
        '5': { source: 'link' },
      },
      buttons: { '0': { source: 'link_code' } },
    })
  })
})

describe('IssueWhatsAppButton', () => {
  it('turns the WhatsApp version on with a Z-API text and the legal basis', async () => {
    const { user, fetch } = setup(
      dtoOf(),
      dtoOf({ enabled: true, consentConfirmedAt: '2026-10-28T13:00:00Z' }),
    )
    await user.click(
      await screen.findByRole('button', { name: 'Enviar também no WhatsApp' }),
    )
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('switch'))
    expect(
      within(dialog).getByText(/assinantes recebem no WhatsApp/),
    ).toBeTruthy()
    const text = await within(dialog).findByLabelText('Mensagem')
    await user.clear(text)
    await user.type(text, 'Leia {{link}')
    await user.click(within(dialog).getByRole('checkbox'))
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }))
    await waitFor(() =>
      expect(
        fetch.calls().find((call) => call.init?.method === 'PATCH'),
      ).toBeTruthy(),
    )
    const patch = fetch.calls().find((call) => call.init?.method === 'PATCH')
    expect(patch?.url).toBe(
      '/api/workspaces/ws1/crm/newsletters/nl1/issues/is1/whatsapp',
    )
    expect(JSON.parse(String(patch?.init?.body))).toEqual({
      enabled: true,
      connectionId: 'cz',
      templateId: null,
      variables: null,
      text: 'Leia {link}',
      legalBasis: 'CONSENT',
      confirmLegalBasis: true,
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(await screen.findByText('ligado')).toBeTruthy()
  })

  it('maps the Meta template variables and lists the problems', async () => {
    const { user, fetch } = setup(
      dtoOf({
        enabled: true,
        connectionId: 'cm',
        templateId: 't1',
        variables: {
          header: { '1': { source: 'static', value: 'Oi' } },
          body: {},
          buttons: {},
        },
        problems: ['Preencha as 6 variável(is) do template'],
      }),
    )
    await user.click(
      await screen.findByRole('button', { name: 'Enviar também no WhatsApp' }),
    )
    expect(await screen.findByText('!')).toBeTruthy()
    const dialog = await screen.findByRole('dialog')
    expect(
      await within(dialog).findByText('Preencha as 6 variável(is) do template'),
    ).toBeTruthy()
    expect(within(dialog).getByText('Oi {{1}}, saiu {{2}}')).toBeTruthy()
    const fixed = within(dialog).getByLabelText('Cabeçalho {{1}}: texto fixo')
    await user.type(fixed, '!')
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }))
    await waitFor(() =>
      expect(
        fetch.calls().find((call) => call.init?.method === 'PATCH'),
      ).toBeTruthy(),
    )
    const patch = fetch.calls().find((call) => call.init?.method === 'PATCH')
    expect(JSON.parse(String(patch?.init?.body))).toMatchObject({
      connectionId: 'cm',
      templateId: 't1',
      text: null,
      variables: { header: { '1': { source: 'static', value: 'Oi!' } } },
    })
    // Problems keep the dialog open.
    expect(screen.getByRole('dialog')).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Fechar' }))
  })

  it('explains when the Comunicação module is off', async () => {
    const { user } = setup(
      dtoOf({
        available: false,
        unavailableReason:
          'O módulo Comunicação não está ativo neste workspace',
        reach: null,
      }),
    )
    await user.click(
      await screen.findByRole('button', { name: 'Enviar também no WhatsApp' }),
    )
    expect(
      await screen.findByText(
        'O módulo Comunicação não está ativo neste workspace',
      ),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Salvar' })).toBeNull()
  })
})
