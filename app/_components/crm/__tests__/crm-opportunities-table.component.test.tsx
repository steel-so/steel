import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  type FetchRoute,
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import { CrmOpportunitiesTable } from '../crm-opportunities-table'

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
  useParams: () => ({ 'workspace-slug': 'acme' }),
}))

const OPPORTUNITY = {
  id: 'o1',
  name: 'Renovação anual — Acme',
  amount: 48000,
  pipelineId: 'pl1',
  stageId: 'st2',
  probability: 60,
  closeDate: null,
  companyId: 'c1',
  pointOfContactId: 'p1',
  ownerId: 'u1',
  createdById: 'u1',
  updatedById: 'u1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  customFields: {},
}

function baseRoutes(opportunities: unknown[] = [OPPORTUNITY]): FetchRoute[] {
  return [
    { match: /\/crm\/opportunities$/, data: opportunities },
    { match: /\/crm\/companies$/, data: [{ id: 'c1', name: 'Acme Ltda' }] },
    { match: /\/crm\/people$/, data: [{ id: 'p1', name: 'Ada Lovelace' }] },
    { match: /\/crm\/members$/, data: [{ id: 'u1', name: 'Ana Souza' }] },
    { match: /\/crm\/pipelines$/, data: [{ id: 'pl1', name: 'Vendas B2B' }] },
    {
      match: /\/crm\/pipelines\/pl1\/stages$/,
      data: [
        { id: 'st1', name: 'Prospecção' },
        { id: 'st2', name: 'Negociação' },
      ],
    },
    { match: /\/crm\/products$/, data: [] },
    { match: '/crm/custom-fields', data: [] },
    { match: /line-items$/, data: [] },
    { match: '/crm/activities', data: [] },
  ]
}

function renderTable() {
  return renderWithQuery(
    <CrmOpportunitiesTable workspaceId='ws1' slug='acme' />,
  )
}

describe('<CrmOpportunitiesTable />', { timeout: 15_000 }, () => {
  it('resolves pipeline, stage, company, contact and owner names', async () => {
    mockFetch(baseRoutes())
    renderTable()

    const row = (await screen.findByText('Renovação anual — Acme')).closest(
      'tr',
    ) as HTMLElement
    expect(within(row).getByText(/R\$\s?48\.000/)).toBeTruthy()
    expect(within(row).getByText('60')).toBeTruthy()
    expect(await within(row).findByText('Vendas B2B')).toBeTruthy()
    expect(await within(row).findByText('Negociação')).toBeTruthy()
    expect(within(row).getByText('Acme Ltda')).toBeTruthy()
    expect(within(row).getByText('Ada Lovelace')).toBeTruthy()
  })

  it('creates an opportunity with a default name', async () => {
    const fetchSpy = mockFetch([
      ...baseRoutes([]),
      {
        method: 'POST',
        match: /\/crm\/opportunities$/,
        data: { ...OPPORTUNITY, id: 'o2', name: 'Sem título' },
      },
    ])
    renderTable()
    await screen.findByText('Nada por aqui ainda')

    fireEvent.click(screen.getAllByText(/^Nov[oa] oportunidade$/)[0])

    await waitFor(() =>
      expect(fetchBody(fetchSpy, /\/crm\/opportunities$/)).toEqual({
        name: 'Sem título',
      }),
    )
  })

  it('opens the details panel with line items and the activity feed', async () => {
    mockFetch(baseRoutes())
    renderTable()
    const row = (await screen.findByText('Renovação anual — Acme')).closest(
      'tr',
    ) as HTMLElement

    fireEvent.click(within(row).getByLabelText('Abrir detalhes'))

    expect(await screen.findByText('Itens')).toBeTruthy()
    expect(
      await screen.findByText(
        'Sem itens. O valor da oportunidade é editável manualmente.',
      ),
    ).toBeTruthy()
    expect(screen.getByText('Atividade')).toBeTruthy()
    expect(screen.getByText('Gerar proposta')).toBeTruthy()
  })

  it('parses a pt-BR decimal amount typed inline', async () => {
    const fetchSpy = mockFetch([
      ...baseRoutes(),
      {
        method: 'PATCH',
        match: '/crm/opportunities/o1',
        data: { ...OPPORTUNITY, amount: 1234.5 },
      },
    ])
    renderTable()
    const row = (await screen.findByText('Renovação anual — Acme')).closest(
      'tr',
    ) as HTMLElement

    fireEvent.click(within(row).getByText(/R\$\s?48\.000/))
    const input = within(row).getByDisplayValue('48000')
    fireEvent.change(input, { target: { value: '1234,5' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() =>
      expect(fetchBody(fetchSpy, '/crm/opportunities/o1', 'PATCH')).toEqual({
        amount: 1234.5,
      }),
    )
  })
})
