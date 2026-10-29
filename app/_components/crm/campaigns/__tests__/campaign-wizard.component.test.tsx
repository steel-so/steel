import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import type { CrmCampaignDetailDTO } from '@/types/crm-campaign'
import { CrmCampaignWizard } from '../campaign-wizard'
import { campaign, options, SLUG, WS } from './fixtures'

vi.mock('@/lib/notify', () => ({
  notify: { success: vi.fn(), error: vi.fn() },
}))
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => router }))

function setup(
  c: CrmCampaignDetailDTO = campaign(),
  opts = options(),
  extra: Parameters<typeof mockFetch>[0] = [],
) {
  const spy = mockFetch([
    ...extra,
    {
      match: '/crm/email-senders',
      data: {
        platformAddress: 'notificacoes@stratustelecom.com.br',
        verifiedDomains: ['news.acme.com.br'],
      },
    },
    {
      method: 'PATCH',
      match: `/crm/campaigns/${c.id}`,
      handler: (_url, init) => ({
        ...c,
        ...JSON.parse(String(init?.body)),
      }),
    },
    {
      method: 'POST',
      match: '/crm/campaigns/audience-preview',
      data: {
        total: 3,
        email: { reachable: 2, optedOut: 1, missing: 0 },
        whatsapp: { reachable: 1, optedOut: 0, missing: 2 },
      },
    },
    {
      method: 'POST',
      match: `/crm/campaigns/${c.id}/launch`,
      data: { ...c, status: 'SENDING' },
    },
    {
      match: `/crm/campaigns/${c.id}/preview`,
      data: { subject: 'Oferta', html: '<p>Oi Maria</p>', text: 'Oi Maria' },
    },
  ])
  renderWithQuery(
    <CrmCampaignWizard
      workspaceId={WS}
      workspaceSlug={SLUG}
      campaign={c}
      options={opts}
      onRefreshOptions={vi.fn()}
    />,
  )
  return spy
}

describe('CrmCampaignWizard', () => {
  it('should show the 4 steps with a progress bar', () => {
    setup()
    for (const label of [
      'Destino',
      'Conteúdo',
      'Público',
      'Revisar e enviar',
    ]) {
      expect(
        screen.getByRole('button', { name: new RegExp(label) }),
      ).toBeTruthy()
    }
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe(
      '1',
    )
  })

  it('should show the tracked links per channel for the destination', () => {
    setup()
    expect(
      screen.getByText(
        /utm_source=email&utm_medium=campanha&utm_campaign=black-friday/,
      ),
    ).toBeTruthy()
    expect(screen.getByText(/utm_source=whatsapp/)).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Copiar link do e-mail' }),
    ).toBeTruthy()
  })

  it('should switch to a site page, clearing the form, and save on continue', async () => {
    const spy = setup()
    fireEvent.click(screen.getByRole('tab', { name: /Sites/ }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Usar o site Clínica Sorriso' }),
    )
    expect(
      screen.getByText(
        'https://app.test/s/clinica?utm_source=email&utm_medium=campanha&utm_campaign=black-friday',
      ),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Continuar/ }))
    await waitFor(() =>
      expect(fetchBody(spy, '/crm/campaigns/c1', 'PATCH')).toMatchObject({
        destinationType: 'SITE_PAGE',
        siteId: 's1',
        sitePageId: 'home',
        formId: null,
        landingPageId: null,
      }),
    )
    await waitFor(() => expect(screen.getByLabelText('Remetente')).toBeTruthy())
  })

  it('should warn about an unpublished destination', () => {
    setup(campaign({ formId: 'f2' }))
    expect(screen.getByText(/Publique antes de enviar/)).toBeTruthy()
  })

  it('should keep WhatsApp off when Comunicação is unavailable', () => {
    setup(
      campaign(),
      options({
        whatsapp: {
          available: false,
          reason: 'O módulo Comunicação não está ativo neste workspace',
          connections: [],
          quickReplies: [],
        },
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: /Conteúdo/ }))
    return waitFor(() => {
      expect(screen.getByText(/Comunicação não está ativo/)).toBeTruthy()
      const toggle = document.querySelector(
        '[aria-label="Também enviar pelo WhatsApp"]',
      )
      expect(toggle?.hasAttribute('data-disabled')).toBe(true)
    })
  })

  it('should ask Z-API for text with {link}', async () => {
    setup(campaign({ whatsappEnabled: true, whatsappConnectionId: 'zapi' }))
    fireEvent.click(screen.getByRole('button', { name: /Conteúdo/ }))
    await waitFor(() => expect(screen.getByLabelText('Mensagem')).toBeTruthy())
    expect(
      screen.getByText(/link rastreado da campanha — obrigatório/),
    ).toBeTruthy()
    expect(screen.queryByLabelText('Template aprovado')).toBeNull()
    fireEvent.change(screen.getByLabelText('Mensagem'), {
      target: { value: 'Oi {nome} {link}' },
    })
    expect(
      (screen.getByLabelText('Mensagem') as HTMLTextAreaElement).value,
    ).toBe('Oi {nome} {link}')
  })

  it('should ask Meta for an approved template and its variables', async () => {
    setup(
      campaign({
        whatsappEnabled: true,
        whatsappConnectionId: 'meta',
        whatsappTemplateId: 'wt1',
        whatsappVariables: {
          header: {},
          body: { '1': { source: 'static', value: 'Promo' } },
          buttons: {},
        },
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: /Conteúdo/ }))
    await waitFor(() =>
      expect(screen.getByText('Oi Promo, confira: {{2}}')).toBeTruthy(),
    )
    expect(screen.getByText('Mensagem {{1}}')).toBeTruthy()
    expect(screen.getByText('Mensagem {{2}}')).toBeTruthy()
    expect(screen.getByText('Botão “Ver oferta” (fim da URL)')).toBeTruthy()
    expect(screen.queryByLabelText('Mensagem')).toBeNull()
    fireEvent.change(screen.getByLabelText('Texto de Mensagem {{1}}'), {
      target: { value: 'Oferta' },
    })
    fireEvent.change(
      screen.getByLabelText('Enviar quantas horas depois do e-mail?'),
      {
        target: { value: '2' },
      },
    )
    expect(screen.getByRole('button', { name: /Salvar rascunho/ })).toBeTruthy()
  })

  it('should launch only after consent and without issues', async () => {
    const spy = setup()
    fireEvent.click(screen.getByRole('button', { name: /Revisar e enviar/ }))
    const send = await screen.findByRole('button', { name: /Enviar campanha/ })
    expect((send as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(
      screen.getByRole('checkbox', { name: /Confirmo a base legal/ }),
    )
    await waitFor(() =>
      expect((send as HTMLButtonElement).disabled).toBe(false),
    )
    fireEvent.click(send)
    await waitFor(() =>
      expect(fetchBody(spy, '/crm/campaigns/c1/launch')).toEqual({
        confirmLegalBasis: true,
      }),
    )
  })

  it('should list the issues on the review step and block the launch', async () => {
    setup(
      campaign({
        issues: [{ step: 'content', message: 'Informe o assunto do e-mail' }],
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: /Revisar e enviar/ }))
    expect(await screen.findByText('Informe o assunto do e-mail')).toBeTruthy()
    fireEvent.click(
      screen.getByRole('checkbox', { name: /Confirmo a base legal/ }),
    )
    expect(
      (
        screen.getByRole('button', {
          name: /Enviar campanha/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
  })

  it('should schedule with a send window', async () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: /Revisar e enviar/ }))
    fireEvent.click(await screen.findByRole('radio', { name: 'Agendar' }))
    expect(await screen.findByLabelText('Data e hora (Brasília)')).toBeTruthy()
    expect(
      screen.getByRole('button', { name: /Agendar campanha/ }),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('switch'))
    expect((screen.getByLabelText('Das') as HTMLInputElement).value).toBe('8')
    expect((screen.getByLabelText('às') as HTMLInputElement).value).toBe('18')
  })

  it('should send a test e-mail', async () => {
    const spy = setup(campaign(), options(), [
      {
        method: 'POST',
        match: '/crm/campaigns/c1/test-send',
        data: { email: 'sent', whatsapp: null, errors: [] },
      },
    ])
    fireEvent.click(screen.getByRole('button', { name: /Revisar e enviar/ }))
    fireEvent.change(await screen.findByLabelText('E-mail de teste'), {
      target: { value: 'eu@acme.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar teste' }))
    await waitFor(() =>
      expect(fetchBody(spy, '/crm/campaigns/c1/test-send')).toEqual({
        email: 'eu@acme.com',
      }),
    )
  })
})
