import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  type FetchRoute,
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import type {
  CrmCustomerHealthDTO,
  CrmOpportunityHealthDTO,
} from '@/types/crm-health'
import { CrmOpportunitiesTable } from '../../crm-opportunities-table'
import { CustomerHealthPanel, OpportunityHealthPanel } from '../health-panel'
import { HealthBadge, healthReason } from '../health-parts'

const notify = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}))
vi.mock('@/lib/notify', () => ({ notify }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/acme/crm/opportunities',
}))

const factor = {
  key: 'engagement',
  label: 'Sem interação recente',
  points: 17.5,
  max: 20,
  detail: 'Última interação há 52 dias',
}
const nextAction = {
  key: 'reach_out',
  label: 'Retomar o contato com o cliente',
  detail: 'Ligue ou mande uma mensagem hoje.',
}

const CUSTOMER: CrmCustomerHealthDTO = {
  companyId: 'c1',
  companyName: 'Acme Ltda',
  riskScore: 78,
  healthScore: 22,
  level: 'HIGH',
  levelLabel: 'Risco alto',
  factors: [factor],
  missing: ['Sentimento no WhatsApp'],
  nextAction,
  riskDelta: 12,
  computedAt: '2026-10-30T12:00:00.000Z',
}

const DEAL: CrmOpportunityHealthDTO = {
  opportunityId: 'o1',
  opportunityName: 'Renovação anual',
  riskScore: 82,
  level: 'HIGH',
  levelLabel: 'Risco alto',
  factors: [
    { ...factor, key: 'stalled', detail: 'Sem movimentação há 40 dias' },
  ],
  nextAction: {
    key: 'reactivate',
    label: 'Retomar o negócio hoje',
    detail: 'Ligue.',
  },
  riskDelta: null,
  computedAt: '2026-10-30T12:00:00.000Z',
}

describe('<HealthBadge />', () => {
  it('shows the band, the score and the reason, never a bare number', () => {
    renderWithQuery(
      <HealthBadge
        level='HIGH'
        levelLabel='Risco alto'
        riskScore={82}
        factors={DEAL.factors}
      />,
    )
    expect(screen.getByText('Risco alto · 82')).toBeTruthy()
    expect(
      screen.getByText(
        'Risco alto, nota de risco 82 de 100: Sem movimentação há 40 dias',
      ),
    ).toBeTruthy()
  })

  it('hides itself without a reason or in the low band', () => {
    const { container, rerender } = renderWithQuery(
      <HealthBadge level='HIGH' levelLabel='x' riskScore={90} factors={[]} />,
    )
    expect(container.textContent).toBe('')
    rerender(
      <HealthBadge
        level='LOW'
        levelLabel='Risco baixo'
        riskScore={10}
        factors={[factor]}
      />,
    )
    expect(container.textContent).toBe('')
    rerender(
      <HealthBadge
        level='LOW'
        levelLabel='Risco baixo'
        riskScore={10}
        factors={[factor]}
        showLow
      />,
    )
    expect(screen.getByText('Risco baixo · 10')).toBeTruthy()
  })

  it('joins up to three reasons', () => {
    const many = [1, 2, 3, 4].map((n) => ({
      ...factor,
      key: `k${n}`,
      detail: `d${n}`,
    }))
    expect(healthReason(many)).toBe('d1 · d2 · d3')
  })
})

describe('<CustomerHealthPanel />', () => {
  const routes = (extra: FetchRoute[] = []): FetchRoute[] => [
    { match: '/crm/health/companies/c1', data: CUSTOMER },
    { match: '/crm/tasks', method: 'POST', data: { id: 't1' } },
    ...extra,
  ]

  it('explains the score and what is missing', async () => {
    mockFetch(routes())
    renderWithQuery(
      <CustomerHealthPanel workspaceId='ws1' companyId='c1' canEdit />,
    )
    expect(await screen.findByText('22% saudável')).toBeTruthy()
    expect(screen.getByText(/Nota de risco 78\/100/)).toBeTruthy()
    expect(screen.getByText(/Risco subiu 12 pontos/)).toBeTruthy()
    expect(screen.getByText('Por que esta nota')).toBeTruthy()
    expect(
      screen.getByText('Última interação há 52 dias', { exact: false }),
    ).toBeTruthy()
    expect(screen.getByText('Retomar o contato com o cliente')).toBeTruthy()
    expect(
      screen.getByText(/Sem dados para: Sentimento no WhatsApp/),
    ).toBeTruthy()
  })

  it('recomputes on demand', async () => {
    const spy = mockFetch(
      routes([
        {
          match: '/crm/health/companies/c1',
          method: 'POST',
          data: { ...CUSTOMER, riskScore: 60, healthScore: 40, riskDelta: -18 },
        },
      ]),
    )
    renderWithQuery(
      <CustomerHealthPanel workspaceId='ws1' companyId='c1' canEdit />,
    )
    await screen.findByText('22% saudável')
    fireEvent.click(screen.getByRole('button', { name: /Recalcular/ }))
    expect(await screen.findByText('40% saudável')).toBeTruthy()
    expect(screen.getByText(/Risco caiu 18 pontos/)).toBeTruthy()
    expect(notify.success).toHaveBeenCalledWith('Saúde recalculada')
    expect(spy).toHaveBeenCalled()
  })

  it('creates a task from the suggested action', async () => {
    const spy = mockFetch(routes())
    renderWithQuery(
      <CustomerHealthPanel workspaceId='ws1' companyId='c1' canEdit />,
    )
    await screen.findByText('22% saudável')
    fireEvent.click(screen.getByRole('button', { name: /Criar tarefa/ }))
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Tarefa criada para amanhã'),
    )
    const body = fetchBody(spy, '/crm/tasks')
    expect(body).toMatchObject({
      title: 'Retomar o contato com o cliente - Acme Ltda',
      companyId: 'c1',
    })
    expect(body.dueDate).toBeTruthy()
  })

  it('hides the actions from a viewer and shows a calm error', async () => {
    mockFetch(routes())
    const { unmount } = renderWithQuery(
      <CustomerHealthPanel workspaceId='ws1' companyId='c1' canEdit={false} />,
    )
    await screen.findByText('22% saudável')
    expect(screen.queryByRole('button', { name: /Recalcular/ })).toBeNull()
    unmount()

    mockFetch([{ match: '/crm/health/companies/c1', status: 500, error: 'x' }])
    renderWithQuery(
      <CustomerHealthPanel workspaceId='ws1' companyId='c1' canEdit />,
    )
    expect(
      await screen.findByText('Não foi possível calcular a nota agora.'),
    ).toBeTruthy()
  })

  it('shows a calm line when nothing is wrong', async () => {
    mockFetch([
      {
        match: '/crm/health/companies/c1',
        data: {
          ...CUSTOMER,
          factors: [],
          riskScore: 0,
          healthScore: 100,
          level: 'LOW',
          levelLabel: 'Risco baixo',
          riskDelta: 0,
          missing: [],
        },
      },
    ])
    renderWithQuery(
      <CustomerHealthPanel workspaceId='ws1' companyId='c1' canEdit />,
    )
    expect(await screen.findByText('Nenhum sinal de risco agora.')).toBeTruthy()
    expect(screen.getByText(/Estável desde o último cálculo/)).toBeTruthy()
  })
})

describe('<OpportunityHealthPanel />', () => {
  it('shows the deal score with the next action and creates a task', async () => {
    const spy = mockFetch([
      { match: '/crm/health/opportunities/o1', data: DEAL },
      { match: '/crm/tasks', method: 'POST', data: { id: 't1' } },
    ])
    renderWithQuery(
      <OpportunityHealthPanel workspaceId='ws1' opportunityId='o1' canEdit />,
    )
    expect(await screen.findByText('Risco 82/100')).toBeTruthy()
    expect(screen.getByText('Retomar o negócio hoje')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Criar tarefa/ }))
    await waitFor(() =>
      expect(fetchBody(spy, '/crm/tasks')).toMatchObject({
        opportunityId: 'o1',
      }),
    )
  })

  it('renders nothing for a deal without score (won or lost)', async () => {
    mockFetch([
      { match: '/crm/health/opportunities/o1', status: 409, error: 'x' },
    ])
    const { container } = renderWithQuery(
      <OpportunityHealthPanel workspaceId='ws1' opportunityId='o1' canEdit />,
    )
    await waitFor(() => expect(container.querySelector('section')).toBeNull())
  })
})

describe('<CrmOpportunitiesTable /> kanban badge', () => {
  it('shows the risk badge and the next action on the card', async () => {
    window.localStorage.clear()
    mockFetch([
      {
        match: /\/crm\/opportunities$/,
        data: [
          {
            id: 'o1',
            name: 'Renovação anual',
            amount: 48000,
            pipelineId: 'pl1',
            stageId: 'st1',
            companyId: 'c1',
            createdById: 'u1',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-02T00:00:00.000Z',
            customFields: {},
          },
        ],
      },
      { match: /health\/opportunities\?/, data: [DEAL] },
      { match: /\/crm\/companies$/, data: [{ id: 'c1', name: 'Acme Ltda' }] },
      { match: /\/crm\/people$/, data: [] },
      { match: /\/crm\/members$/, data: [] },
      {
        match: /\/crm\/pipelines$/,
        data: [{ id: 'pl1', name: 'Vendas B2B', isDefault: true }],
      },
      {
        match: /\/crm\/pipelines\/pl1\/stages$/,
        data: [
          { id: 'st1', name: 'Prospecção', position: 0, category: 'OPEN' },
          { id: 'st2', name: 'Negociação', position: 1, category: 'OPEN' },
        ],
      },
      { match: /\/crm\/products$/, data: [] },
      { match: '/crm/custom-fields', data: [] },
    ])
    renderWithQuery(<CrmOpportunitiesTable workspaceId='ws1' slug='acme' />)

    await screen.findByText('Renovação anual')
    fireEvent.click(
      screen.getByRole('button', { name: 'Visualizar em kanban' }),
    )

    expect(await screen.findByText('Risco alto · 82')).toBeTruthy()
    expect(screen.getByText('Prospecção')).toBeTruthy()
    expect(screen.getByText('Negociação')).toBeTruthy()
    expect(screen.getByText('Retomar o negócio hoje')).toBeTruthy()
    expect(screen.getByText(/R\$\s?48\.000/)).toBeTruthy()
  })
})
