import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import type {
  WhatsAppCostReportDTO,
  WhatsAppCostSettingsDTO,
  WhatsAppPriceDTO,
} from '@/types/whatsapp-cost'
import { WhatsappReportsTabs } from '../../whatsapp-reports-tabs'
import {
  formatBrl,
  formatBrlPrice,
  formatFullDay,
  formatShortDay,
  presetRange,
  todayInSaoPaulo,
} from '../whatsapp-costs-format'
import { parseMoneyInput } from '../whatsapp-costs-settings'
import { WhatsAppCostsTab } from '../whatsapp-costs-tab'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}))
vi.setConfig({ testTimeout: 20_000 })

const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/notify', () => ({ notify }))

const BASE = '/api/workspaces/ws_1/whatsapp'

const report: WhatsAppCostReportDTO = {
  workspaceId: 'ws_1',
  currency: 'BRL',
  from: '2026-10-01',
  to: '2026-10-10',
  connectionId: null,
  totals: {
    messages: 300,
    templateMessages: 100,
    serviceMessages: 200,
    variableCost: 36.25,
    fees: 100,
    totalCost: 136.25,
    conversations: 50,
    resolvedConversations: 25,
    costPerConversation: 2.73,
    costPerResolvedConversation: 5.45,
  },
  trend: [
    { date: '2026-10-01', cost: 10, messages: 40 },
    { date: '2026-10-02', cost: 26.25, messages: 60 },
  ],
  byConnection: [
    {
      connectionId: 'c1',
      label: 'Oficial',
      provider: 'META',
      messages: 100,
      conversations: 10,
      variableCost: 36.25,
      fee: 0,
      totalCost: 36.25,
      costPerMessage: 0.36,
      costPerConversation: 3.63,
    },
  ],
  byProvider: [
    {
      provider: 'META',
      connections: 1,
      messages: 100,
      conversations: 10,
      variableCost: 36.25,
      fee: 0,
      totalCost: 36.25,
      costPerMessage: 0.36,
      costPerConversation: 3.63,
    },
    {
      provider: 'ZAPI',
      connections: 0,
      messages: 0,
      conversations: 0,
      variableCost: 0,
      fee: 0,
      totalCost: 0,
      costPerMessage: 0,
      costPerConversation: 0,
    },
  ],
  byCategory: [
    { key: 'MARKETING', label: 'Marketing', messages: 100, cost: 36.25 },
  ],
  byBroadcast: [],
  byAiCampaign: [],
  byAgent: [{ key: 'u1', label: 'Ana', messages: 5, cost: 1 }],
  bySource: [],
  projection: {
    period: '2026-10',
    monthCost: 372,
    variableToDate: 30,
    fees: 310,
    daysElapsed: 15,
    daysInMonth: 31,
  },
  budget: { monthlyCostBudget: 400, spent: 340, percent: 85, level: 80 },
}

const settings: WhatsAppCostSettingsDTO = {
  monthlyCostBudget: 400,
  connections: [
    { id: 'c1', label: 'Oficial', provider: 'META', monthlyFee: null },
    { id: 'c2', label: 'Z-API vendas', provider: 'ZAPI', monthlyFee: 199 },
  ],
}

const prices: WhatsAppPriceDTO[] = [
  {
    id: 'p1',
    category: 'MARKETING',
    country: 'BR',
    currency: 'BRL',
    unitPrice: 0.3625,
    validFrom: '2000-01-01T00:00:00.000Z',
    reference: true,
  },
  {
    id: 'p2',
    category: 'UTILITY',
    country: 'BR',
    currency: 'BRL',
    unitPrice: 0.05,
    validFrom: '2026-07-01T03:00:00.000Z',
    reference: false,
  },
]

function setup(extra: Parameters<typeof mockFetch>[0] = []) {
  return mockFetch([
    ...extra,
    { match: `${BASE}/costs/settings`, data: settings },
    { match: `${BASE}/costs/prices`, data: prices },
    { match: `${BASE}/costs?`, data: report },
  ])
}

describe('cost format helpers', () => {
  it('formats money in pt-BR', () => {
    expect(formatBrl(1234.5).replace(/\s/g, ' ')).toBe('R$ 1.234,50')
    expect(formatBrlPrice(0.3625).replace(/\s/g, ' ')).toBe('R$ 0,3625')
  })

  it('formats days without touching the browser time zone', () => {
    expect(formatShortDay('2026-10-05')).toBe('05/10')
    expect(formatFullDay('2026-10-05')).toBe('05/10/2026')
    expect(todayInSaoPaulo(new Date('2026-10-23T01:30:00Z'))).toBe('2026-10-22')
  })

  it('builds the period presets in the São Paulo calendar', () => {
    const now = new Date('2026-10-22T15:00:00Z')
    expect(presetRange('month', now)).toEqual({
      from: '2026-10-01',
      to: '2026-10-22',
    })
    expect(presetRange('7d', now)).toEqual({
      from: '2026-10-16',
      to: '2026-10-22',
    })
    expect(presetRange('30d', now)).toEqual({
      from: '2026-09-23',
      to: '2026-10-22',
    })
    expect(presetRange('previous-month', now)).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
    })
    expect(
      presetRange('previous-month', new Date('2026-01-10T12:00:00Z')),
    ).toEqual({ from: '2025-12-01', to: '2025-12-31' })
  })

  it('parses pt-BR money input', () => {
    expect(parseMoneyInput('')).toBeNull()
    expect(parseMoneyInput(' 1.234,56 ')).toBe(1234.56)
    expect(parseMoneyInput('0,3625')).toBe(0.3625)
    expect(parseMoneyInput('12.5')).toBe(12.5)
    expect(parseMoneyInput('abc')).toBeUndefined()
    expect(parseMoneyInput('-3')).toBeUndefined()
  })
})

describe('<WhatsappReportsTabs />', () => {
  it('hides the money tab from non-admins', async () => {
    mockFetch([{ match: `${BASE}/reports`, data: [] }])
    renderWithQuery(
      <WhatsappReportsTabs
        workspaceId='ws_1'
        slug='acme'
        canSeeCosts={false}
      />,
    )
    expect(
      await screen.findByText('Nenhum relatório criado ainda.'),
    ).toBeTruthy()
    expect(screen.queryByText('Custos')).toBeNull()
  })

  it('shows the tab to admins and opens it from the notification link', async () => {
    setup([{ match: `${BASE}/reports`, data: [] }])
    renderWithQuery(
      <WhatsappReportsTabs
        workspaceId='ws_1'
        slug='acme'
        canSeeCosts
        initialTab='custos'
      />,
    )
    expect(await screen.findByText('Custo no período')).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: 'Relatórios' }))
    expect(
      await screen.findByText('Nenhum relatório criado ainda.'),
    ).toBeTruthy()
  })

  it('starts on the reports list for admins by default', async () => {
    setup([{ match: `${BASE}/reports`, data: [] }])
    renderWithQuery(
      <WhatsappReportsTabs workspaceId='ws_1' slug='acme' canSeeCosts />,
    )
    expect(
      await screen.findByText('Nenhum relatório criado ainda.'),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Custos' }))
    expect(await screen.findByText('Custo no período')).toBeTruthy()
  })
})

describe('<WhatsAppCostsTab />', () => {
  it('renders totals, the budget, the Meta x Z-API comparison and breakdowns', async () => {
    setup()
    renderWithQuery(<WhatsAppCostsTab workspaceId='ws_1' />)

    expect(await screen.findByText('Custo no período')).toBeTruthy()
    expect(screen.getAllByText(/136,25/).length).toBeGreaterThan(0)
    expect(screen.getByText('Meta x Z-API')).toBeTruthy()
    expect(screen.getByText('Por categoria')).toBeTruthy()
    expect(screen.getByText('Ana')).toBeTruthy()
    expect(screen.getByText(/85% consumido/)).toBeTruthy()
    expect(screen.getByText(/passou de 80%/)).toBeTruthy()
    expect(screen.getByText(/confira na sua conta Meta/)).toBeTruthy()
    expect(
      screen.getByRole('progressbar', { name: 'Consumo do orçamento mensal' }),
    ).toBeTruthy()
  })

  it('sends the chosen period and connection to the API', async () => {
    const spy = setup()
    renderWithQuery(<WhatsAppCostsTab workspaceId='ws_1' />)
    await screen.findByText('Custo no período')

    fireEvent.click(screen.getByRole('button', { name: 'Últimos 7 dias' }))
    await waitFor(() =>
      expect(
        spy.mock.calls.some(([url]) => /costs\?from=.*&to=/.test(String(url))),
      ).toBe(true),
    )
    const calls = spy.mock.calls.map(([url]) => String(url))
    expect(
      calls.filter((url) => url.includes('/costs?')).length,
    ).toBeGreaterThan(1)
  })

  it('links the CSV export with the same filters', async () => {
    setup()
    renderWithQuery(<WhatsAppCostsTab workspaceId='ws_1' />)
    await screen.findByText('Custo no período')
    const link = screen.getByRole('link', { name: /Exportar CSV/ })
    expect(link.getAttribute('href')).toMatch(
      /\/api\/workspaces\/ws_1\/whatsapp\/costs\/export\?from=\d{4}-\d{2}-\d{2}&to=/,
    )
  })

  it('shows the API error when the report fails', async () => {
    mockFetch([
      { match: `${BASE}/costs/settings`, data: settings },
      { match: `${BASE}/costs/prices`, data: prices },
      { match: `${BASE}/costs?`, status: 403, error: 'Sem permissão' },
    ])
    renderWithQuery(<WhatsAppCostsTab workspaceId='ws_1' />)
    expect(await screen.findByText('Sem permissão')).toBeTruthy()
  })

  it('shows the empty trend message when nothing was sent', async () => {
    mockFetch([
      { match: `${BASE}/costs/settings`, data: settings },
      { match: `${BASE}/costs/prices`, data: prices },
      {
        match: `${BASE}/costs?`,
        data: {
          ...report,
          trend: [],
          byCategory: [],
          budget: {
            ...report.budget,
            monthlyCostBudget: null,
            percent: null,
            level: null,
          },
        },
      },
    ])
    renderWithQuery(<WhatsAppCostsTab workspaceId='ws_1' />)
    expect(await screen.findByText(/Sem envios entre/)).toBeTruthy()
    expect(
      screen.getAllByText('Sem envios no período.').length,
    ).toBeGreaterThan(0)
    expect(screen.getByText('Defina um valor para receber avisos')).toBeTruthy()
  })
})

describe('cost settings form', () => {
  it('lists the prices with the reference badge and saves a new one', async () => {
    const spy = setup([
      {
        method: 'POST',
        match: `${BASE}/costs/prices`,
        data: prices[1],
        status: 201,
      },
    ])
    renderWithQuery(<WhatsAppCostsTab workspaceId='ws_1' />)

    expect(await screen.findByText('Referência')).toBeTruthy()
    expect(screen.getByText('01/07/2026')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Preço (R$)'), {
      target: { value: '0,07' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar preço' }))

    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Preço salvo.'),
    )
    expect(fetchBody(spy, '/costs/prices')).toMatchObject({
      category: 'MARKETING',
      country: 'BR',
      unitPrice: 0.07,
    })
  })

  it('rejects an invalid price before calling the API', async () => {
    setup()
    renderWithQuery(<WhatsAppCostsTab workspaceId='ws_1' />)
    await screen.findByText('Referência')
    fireEvent.click(screen.getByRole('button', { name: 'Salvar preço' }))
    expect(notify.error).toHaveBeenCalledWith(
      'Informe um preço válido (ex.: 0,3625).',
    )
  })

  it('deletes a price', async () => {
    const spy = setup([
      {
        method: 'DELETE',
        match: `${BASE}/costs/prices/p2`,
        data: { id: 'p2' },
      },
    ])
    renderWithQuery(<WhatsAppCostsTab workspaceId='ws_1' />)
    await screen.findByText('Referência')
    fireEvent.click(
      screen.getByRole('button', { name: 'Excluir preço de Utilidade (BR)' }),
    )
    await waitFor(() =>
      expect(spy.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(
        true,
      ),
    )
  })

  it('saves the budget and the monthly fees', async () => {
    const spy = setup([
      {
        method: 'PATCH',
        match: `${BASE}/costs/settings`,
        data: { ...settings, monthlyCostBudget: 500 },
      },
    ])
    renderWithQuery(<WhatsAppCostsTab workspaceId='ws_1' />)

    const budget = (await screen.findByLabelText(
      'Orçamento mensal (R$)',
    )) as HTMLInputElement
    await waitFor(() => expect(budget.value).toBe('400'))
    fireEvent.change(budget, { target: { value: '500' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith(
        'Orçamento e mensalidades salvos.',
      ),
    )
    expect(fetchBody(spy, '/costs/settings', 'PATCH')).toEqual({
      monthlyCostBudget: 500,
      connectionFees: [
        { connectionId: 'c1', monthlyFee: null },
        { connectionId: 'c2', monthlyFee: 199 },
      ],
    })
  })

  it('refuses an invalid budget or fee', async () => {
    setup()
    renderWithQuery(<WhatsAppCostsTab workspaceId='ws_1' />)
    const budget = await screen.findByLabelText('Orçamento mensal (R$)')
    fireEvent.change(budget, { target: { value: 'muito' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(notify.error).toHaveBeenCalledWith(
      'Informe um orçamento válido (ex.: 500,00) ou deixe em branco.',
    )

    fireEvent.change(budget, { target: { value: '400' } })
    fireEvent.change(screen.getByLabelText(/Mensalidade — Z-API vendas/), {
      target: { value: 'x' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(notify.error).toHaveBeenCalledWith(
      'Mensalidade inválida em "Z-API vendas".',
    )
  })
})
