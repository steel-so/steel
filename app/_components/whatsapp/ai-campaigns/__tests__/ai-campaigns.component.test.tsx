import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  type FetchRoute,
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import type { WhatsAppAiCampaignDTO } from '@/types/whatsapp-ai-campaign'
import { actionDraftProblem } from '../ai-campaign-actions-editor'
import { WhatsappAiCampaignDetail } from '../ai-campaign-detail'
import { WhatsappAiCampaignWizard } from '../ai-campaign-wizard'
import { WhatsappAiCampaignsPage } from '../ai-campaigns-page'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
}))
vi.setConfig({ testTimeout: 20_000 })

const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/notify', () => ({ notify }))

const BASE = '/api/workspaces/ws_1/whatsapp/ai-campaigns'

function campaign(
  overrides: Partial<WhatsAppAiCampaignDTO> = {},
): WhatsAppAiCampaignDTO {
  return {
    id: 'c1',
    name: 'Cobrança de outubro',
    objective: 'Lembrar dos boletos',
    connectionId: 'conn_1',
    templateId: 'tpl_1',
    template: {
      id: 'tpl_1',
      name: 'lembrete_boleto',
      language: 'pt_BR',
      status: 'APPROVED',
    },
    variables: { header: {}, body: {}, buttons: {} },
    headerMediaUrl: null,
    instructions: 'Seja cordial.',
    actions: [
      {
        id: 'a1',
        kind: 'TRANSFER_TEAM',
        label: 'Falar com o financeiro',
        when: 'Quando pedir segunda via',
        teamId: 'team_1',
      },
    ],
    intervalSeconds: 30,
    aiReplies: true,
    skipNoWhatsapp: false,
    status: 'PAUSED',
    lastSentAt: null,
    lastError: null,
    startedAt: null,
    finishedAt: null,
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
    stats: {
      total: 10,
      pending: 6,
      sent: 4,
      failed: 0,
      skipped: 0,
      replied: 2,
      success: 1,
      failure: 0,
      closedWithoutOutcome: 0,
      open: 3,
    },
    problems: [],
    ...overrides,
  }
}

describe('<WhatsappAiCampaignsPage />', () => {
  function setup(list: WhatsAppAiCampaignDTO[], extra: FetchRoute[] = []) {
    return mockFetch([...extra, { match: BASE, data: list }])
  }

  it('lists campaigns and filters them by status', async () => {
    setup([
      campaign(),
      campaign({ id: 'c2', name: 'Pesquisa NPS', status: 'DRAFT' }),
    ])
    renderWithQuery(<WhatsappAiCampaignsPage workspaceId='ws_1' slug='acme' />)

    expect(await screen.findByText('Cobrança de outubro')).toBeTruthy()
    expect(screen.getByText('Pesquisa NPS')).toBeTruthy()

    const filters = screen.getByRole('group', { name: 'Filtrar por situação' })
    fireEvent.click(within(filters).getByRole('button', { name: 'Rascunho' }))
    expect(screen.queryByText('Cobrança de outubro')).toBeNull()
    expect(screen.getByText('Pesquisa NPS')).toBeTruthy()
  })

  it('shows the empty state', async () => {
    setup([])
    renderWithQuery(<WhatsappAiCampaignsPage workspaceId='ws_1' slug='acme' />)
    expect(await screen.findByText('Nenhuma campanha ainda')).toBeTruthy()
  })

  it('starts a paused campaign from its card', async () => {
    const fetchSpy = setup(
      [campaign()],
      [{ method: 'POST', match: `${BASE}/c1/play`, data: campaign() }],
    )
    renderWithQuery(<WhatsappAiCampaignsPage workspaceId='ws_1' slug='acme' />)
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Iniciar Cobrança de outubro',
      }),
    )
    await waitFor(() =>
      expect(
        fetchSpy.mock.calls.some(
          ([url, init]) =>
            String(url).includes(`${BASE}/c1/play`) && init?.method === 'POST',
        ),
      ).toBe(true),
    )
  })

  it('creates a campaign from a model and opens the wizard', async () => {
    const fetchSpy = setup(
      [],
      [
        {
          method: 'POST',
          match: BASE,
          data: campaign({ id: 'new_1', status: 'DRAFT' }),
        },
      ],
    )
    renderWithQuery(<WhatsappAiCampaignsPage workspaceId='ws_1' slug='acme' />)
    fireEvent.click(
      await screen.findByRole('button', { name: /Nova campanha/ }),
    )
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Nome'), {
      target: { value: 'Confirmação de consultas' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: /Agendamento/ }))
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Criar e configurar' }),
    )

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        '/acme/zap/campanhas-ia/new_1/editar?modelo=scheduling',
      ),
    )
    expect(fetchBody(fetchSpy, BASE)).toMatchObject({
      name: 'Confirmação de consultas',
    })
  })
})

describe('<WhatsappAiCampaignDetail />', () => {
  it('shows the numbers and pauses a running campaign', async () => {
    const running = campaign({ status: 'RUNNING' })
    const fetchSpy = mockFetch([
      { method: 'POST', match: `${BASE}/c1/pause`, data: running },
      { match: `${BASE}/c1/recipients`, data: { items: [], nextCursor: null } },
      { match: `${BASE}/c1/action-runs`, data: [] },
      { match: `${BASE}/c1`, data: running },
    ])
    renderWithQuery(
      <WhatsappAiCampaignDetail
        workspaceId='ws_1'
        slug='acme'
        campaignId='c1'
      />,
    )

    expect(await screen.findByText('Progresso dos envios')).toBeTruthy()
    expect(screen.getByText('4 de 10 · 40%', { exact: false })).toBeTruthy()
    expect(screen.getByText('Falar com o financeiro')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Pausar/ }))
    await waitFor(() =>
      expect(
        fetchSpy.mock.calls.some(([url]) =>
          String(url).includes(`${BASE}/c1/pause`),
        ),
      ).toBe(true),
    )
  })

  it('lists recipients with a link to their conversation', async () => {
    mockFetch([
      {
        match: `${BASE}/c1/recipients`,
        data: {
          items: [
            {
              id: 'r1',
              contactId: 'ct_1',
              contactName: 'Maria',
              waId: '5511999990000',
              status: 'SENT',
              errorMessage: null,
              values: {},
              sentAt: '2026-10-01T13:00:00.000Z',
              repliedAt: null,
              conversationId: 'conv_1',
              conversationStatus: 'CLOSED',
              closeOutcome: 'SUCCESS',
            },
          ],
          nextCursor: null,
        },
      },
      { match: `${BASE}/c1/action-runs`, data: [] },
      { match: `${BASE}/c1`, data: campaign() },
    ])
    renderWithQuery(
      <WhatsappAiCampaignDetail
        workspaceId='ws_1'
        slug='acme'
        campaignId='c1'
      />,
    )

    const link = await screen.findByRole('link', { name: 'Deu certo' })
    expect(link.getAttribute('href')).toBe('/acme/zap?conversa=conv_1')
    expect(screen.getByText('Maria')).toBeTruthy()
  })
})

describe('<WhatsappAiCampaignWizard />', () => {
  function setup(data: WhatsAppAiCampaignDTO, extra: FetchRoute[] = []) {
    return mockFetch([
      ...extra,
      {
        match: '/api/workspaces/ws_1/whatsapp/connections',
        data: [
          {
            id: 'conn_1',
            provider: 'META',
            label: 'Comercial',
            phoneNumber: '+55 11 4000-0000',
          },
        ],
      },
      {
        match: '/api/workspaces/ws_1/whatsapp/business-hours',
        data: {
          enabled: true,
          start: '08:00',
          end: '18:00',
          days: [1, 2, 3, 4, 5],
          open: true,
          nextOpeningAt: null,
        },
      },
      { match: `${BASE}/c1`, data },
    ])
  }

  it('saves the basics and moves to the contacts step', async () => {
    const fetchSpy = setup(campaign({ status: 'DRAFT' }), [
      { method: 'PATCH', match: `${BASE}/c1`, data: campaign() },
      { match: '/whatsapp/contacts', data: [] },
    ])
    renderWithQuery(
      <WhatsappAiCampaignWizard
        workspaceId='ws_1'
        slug='acme'
        campaignId='c1'
      />,
    )

    const name = await screen.findByLabelText('Nome da campanha')
    fireEvent.change(name, { target: { value: 'Cobrança de novembro' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar e continuar' }))

    await waitFor(() =>
      expect(fetchBody(fetchSpy, `${BASE}/c1`, 'PATCH')).toMatchObject({
        name: 'Cobrança de novembro',
      }),
    )
    await waitFor(() =>
      expect(
        screen
          .getByRole('button', { name: /Contatos/ })
          .getAttribute('aria-current'),
      ).toBe('step'),
    )
  })

  it('lists what is missing on the review step and blocks the start', async () => {
    setup(
      campaign({
        status: 'DRAFT',
        problems: ['Adicione contatos à campanha'],
      }),
    )
    renderWithQuery(
      <WhatsappAiCampaignWizard
        workspaceId='ws_1'
        slug='acme'
        campaignId='c1'
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: /Revisão/ }))
    expect(await screen.findByText('Adicione contatos à campanha')).toBeTruthy()
    expect(
      (
        screen.getByRole('button', {
          name: /Iniciar campanha/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
    expect(await screen.findByText(/08:00–18:00/)).toBeTruthy()
  })

  it('starts a ready campaign from the review step', async () => {
    const fetchSpy = setup(campaign({ status: 'DRAFT' }), [
      {
        method: 'POST',
        match: `${BASE}/c1/play`,
        data: campaign({ status: 'RUNNING' }),
      },
    ])
    renderWithQuery(
      <WhatsappAiCampaignWizard
        workspaceId='ws_1'
        slug='acme'
        campaignId='c1'
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: /Revisão/ }))
    fireEvent.click(
      await screen.findByRole('button', { name: /Iniciar campanha/ }),
    )
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith('/acme/zap/campanhas-ia/c1'),
    )
    expect(
      fetchSpy.mock.calls.some(([url]) =>
        String(url).includes(`${BASE}/c1/play`),
      ),
    ).toBe(true)
  })
})

describe('actionDraftProblem', () => {
  const base = { id: 'a1', label: 'Transferir', when: 'Quando pedir' }

  it('requires a destination for transfers', () => {
    expect(actionDraftProblem({ ...base, kind: 'TRANSFER_USER' })).toMatch(
      /atendente/,
    )
    expect(
      actionDraftProblem({ ...base, kind: 'TRANSFER_USER', userId: 'u1' }),
    ).toBeNull()
  })

  it('requires a name and when to use it', () => {
    expect(
      actionDraftProblem({ ...base, label: ' ', kind: 'OPT_OUT' }),
    ).toMatch(/nome/)
    expect(actionDraftProblem({ ...base, when: '', kind: 'OPT_OUT' })).toMatch(
      /quando/,
    )
  })

  it('validates follow-up hours and webhook settings', () => {
    expect(
      actionDraftProblem({ ...base, kind: 'FOLLOW_UP', delayHours: 200 }),
    ).toMatch(/168/)
    expect(
      actionDraftProblem({ ...base, kind: 'WEBHOOK', url: 'http://x.test' }),
    ).toMatch(/https/)
    expect(
      actionDraftProblem({
        ...base,
        kind: 'WEBHOOK',
        url: 'https://x.test/hook',
        fields: [{ key: 'Valor', description: 'valor' }],
      }),
    ).toMatch(/campos/)
    expect(
      actionDraftProblem({
        ...base,
        kind: 'WEBHOOK',
        url: 'https://x.test/hook',
        fields: [{ key: 'valor', description: 'Valor combinado' }],
      }),
    ).toBeNull()
  })
})
