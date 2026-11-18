import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import { CampaignResults, CrmCampaignDashboard } from '../campaign-dashboard'
import { campaign, SLUG, stats, WS } from './fixtures'

vi.mock('@/lib/notify', () => ({
  notify: { success: vi.fn(), error: vi.fn() },
}))

const RECIPIENT = {
  id: 'r1',
  name: 'Ana Souza',
  email: 'ana@acme.com',
  waId: '5511999990000',
  personId: 'p1',
  leadId: null,
  emailStatus: 'SENT',
  emailSkipReason: null,
  emailError: null,
  emailSentAt: '2026-10-09T13:00:00.000Z',
  emailDeliveredAt: null,
  emailOpenedAt: '2026-10-09T13:05:00.000Z',
  emailClickedAt: '2026-10-09T13:06:00.000Z',
  emailBouncedAt: null,
  unsubscribedAt: null,
  whatsappStatus: 'SKIPPED',
  whatsappSkipReason: 'opted_out',
  whatsappError: null,
  whatsappSentAt: null,
  whatsappDeliveredAt: null,
  whatsappReadAt: null,
  whatsappClickedAt: null,
  whatsappRepliedAt: null,
  conversationId: null,
  convertedAt: '2026-10-09T13:10:00.000Z',
}

describe('CampaignResults', () => {
  it('should show both funnels and the conversions', () => {
    render(
      <CampaignResults stats={stats()} whatsappEnabled workspaceSlug={SLUG} />,
    )
    const email = screen.getByRole('region', { name: 'E-mail' })
    expect(email.textContent).toMatch(/Enviados10 100%/)
    expect(email.textContent).toMatch(/Abertos5 50%/)
    expect(email.textContent).toContain('1 descadastros')
    const whatsapp = screen.getByRole('region', { name: 'WhatsApp' })
    expect(whatsapp.textContent).toMatch(/Responderam2 50%/)
    const converted = screen.getByRole('region', { name: 'Convertidos' })
    expect(converted.textContent).toContain('e-mail 2 · WhatsApp 1')
    expect(
      screen.getByRole('link', { name: 'Ana Souza' }).getAttribute('href'),
    ).toBe(`/${SLUG}/crm/leads?record=lead1`)
    expect(screen.getByText('3 envio(s) · 0 visita(s)')).toBeTruthy()
  })

  it('should hide WhatsApp and handle no conversions', () => {
    render(
      <CampaignResults
        stats={stats({
          email: { ...stats().email, sent: 0, opened: 0 },
          convertedContacts: [
            {
              id: 'v1',
              kind: 'LANDING_VIEW',
              channel: null,
              recipientId: null,
              name: null,
              leadId: null,
              personId: null,
              createdAt: '2026-10-09T15:00:00.000Z',
            },
          ],
        })}
        whatsappEnabled={false}
        workspaceSlug={SLUG}
      />,
    )
    expect(screen.queryByRole('region', { name: 'WhatsApp' })).toBeNull()
    expect(screen.getByText('Visitante')).toBeTruthy()
    expect(screen.getAllByText('0%').length).toBeGreaterThan(0)
  })

  it('should say when nobody converted', () => {
    render(
      <CampaignResults
        stats={stats({ convertedContacts: [] })}
        whatsappEnabled={false}
        workspaceSlug={SLUG}
      />,
    )
    expect(screen.getByText('Ninguém converteu ainda.')).toBeTruthy()
  })
})

describe('CrmCampaignDashboard', () => {
  function setup(status: 'SENDING' | 'PAUSED' | 'COMPLETED' = 'SENDING') {
    const c = campaign({
      status,
      whatsappEnabled: true,
      startAt: '2026-10-09T13:00:00.000Z',
    })
    const spy = mockFetch([
      { match: '/crm/campaigns/c1/stats', data: stats() },
      {
        match: '/crm/campaigns/c1/recipients',
        data: { items: [RECIPIENT], total: 45, page: 1, pageSize: 20 },
      },
      {
        method: 'POST',
        match: '/crm/campaigns/c1/control',
        handler: (_url, init) => ({
          ...c,
          status:
            JSON.parse(String(init?.body)).action === 'pause'
              ? 'PAUSED'
              : 'SENDING',
        }),
      },
    ])
    renderWithQuery(
      <CrmCampaignDashboard
        workspaceId={WS}
        workspaceSlug={SLUG}
        campaign={c}
      />,
    )
    return spy
  }

  it('should show status, links, results and pause a running campaign', async () => {
    const spy = setup()
    expect(screen.getByText('Enviando')).toBeTruthy()
    expect(screen.getByText(/09\/10\/2026, 10:00/)).toBeTruthy()
    expect(await screen.findByRole('region', { name: 'E-mail' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Pausar/ }))
    await waitFor(() =>
      expect(fetchBody(spy, '/crm/campaigns/c1/control')).toEqual({
        action: 'pause',
      }),
    )
  })

  it('should resume a paused campaign and confirm before canceling', async () => {
    const spy = setup('PAUSED')
    fireEvent.click(screen.getByRole('button', { name: /Retomar/ }))
    await waitFor(() =>
      expect(fetchBody(spy, '/crm/campaigns/c1/control')).toEqual({
        action: 'resume',
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: /Cancelar/ }))
    expect(await screen.findByText('Cancelar a campanha?')).toBeTruthy()
  })

  it('should not offer actions on a finished campaign', () => {
    setup('COMPLETED')
    expect(screen.queryByRole('button', { name: /Pausar/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Cancelar/ })).toBeNull()
  })

  it('should list contacts with a per-contact timeline and paginate', async () => {
    const spy = setup()
    const row = await screen.findByRole('button', { name: /Ana Souza/ })
    expect(row.textContent).toContain('E-mail: Enviado')
    expect(row.textContent).toContain('WhatsApp: Descadastrado (LGPD)')
    expect(row.textContent).toContain('Converteu')
    fireEvent.click(row)
    expect(screen.getByText('E-mail aberto')).toBeTruthy()
    expect(screen.getByText('Clicou no e-mail')).toBeTruthy()
    expect(screen.getByText('1 / 3')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Próxima' }))
    await waitFor(() =>
      expect(
        spy.mock.calls.some(([url]) => String(url).includes('page=2')),
      ).toBe(true),
    )
    fireEvent.change(screen.getByLabelText('Buscar contato'), {
      target: { value: 'ana' },
    })
    await waitFor(() =>
      expect(
        spy.mock.calls.some(([url]) => String(url).includes('search=ana')),
      ).toBe(true),
    )
  })
})

describe('CrmCampaignDashboard quality gate', () => {
  const REASON =
    'Envios bloqueados pela qualidade: o número desta conexão está com qualidade "Baixa" (vermelha) na Meta.'

  function render_(status: 'PAUSED' | 'SENDING', pausedReason: string | null) {
    const c = campaign({
      status,
      pausedReason,
      whatsappEnabled: true,
      startAt: '2026-10-09T13:00:00.000Z',
    })
    mockFetch([
      { match: '/crm/campaigns/c1/stats', data: stats() },
      {
        match: '/crm/campaigns/c1/recipients',
        data: { items: [], total: 0, page: 1, pageSize: 20 },
      },
    ])
    renderWithQuery(
      <CrmCampaignDashboard
        workspaceId={WS}
        workspaceSlug={SLUG}
        campaign={c}
      />,
    )
  }

  it('should say why a campaign paused itself and offer to resume it', () => {
    render_('PAUSED', REASON)
    expect(
      screen.getByText('Envios bloqueados pela qualidade do WhatsApp'),
    ).toBeTruthy()
    expect(
      screen.getByText(/O número desta conexão está com qualidade/),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: /Retomar/ })).toBeTruthy()
  })

  it('should not show the notice for a manual pause or a running campaign', () => {
    render_('PAUSED', null)
    expect(
      screen.queryByText('Envios bloqueados pela qualidade do WhatsApp'),
    ).toBeNull()
  })

  it('should hide a stale reason once the campaign runs again', () => {
    render_('SENDING', REASON)
    expect(
      screen.queryByText('Envios bloqueados pela qualidade do WhatsApp'),
    ).toBeNull()
  })
})
