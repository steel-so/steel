import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import type { WhatsAppSpendCapStatusDTO } from '@/types/whatsapp-spend-cap'
import {
  ConnectionSpendCapButton,
  formatFetchedAgo,
  WhatsAppSpendCapsCard,
} from '../whatsapp-spend-caps'

vi.setConfig({ testTimeout: 20_000 })

const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/notify', () => ({ notify }))

const URL = '/api/workspaces/ws_1/whatsapp/costs/spend-caps'

function status(
  overrides: Partial<WhatsAppSpendCapStatusDTO> = {},
): WhatsAppSpendCapStatusDTO {
  return {
    connectionId: 'c1',
    label: 'Fidelizza+',
    phoneNumber: '5511999990000',
    period: '2026-11',
    currency: 'BRL',
    monthlyCapAmount: 1500,
    capMode: 'BLOCK',
    spent: 1220,
    metaSpent: 1100,
    ledgerSpent: 120,
    source: 'META_VOLUME',
    byCategory: [
      {
        category: 'MARKETING',
        label: 'Marketing',
        volume: 496,
        billableVolume: 496,
        cost: 159.56,
      },
    ],
    fetchedAt: new Date(Date.now() - 3 * 60_000).toISOString(),
    metaPeriodEnd: '2026-11-11T00:00:00.000Z',
    stale: false,
    staleReason: null,
    percent: 81,
    level: 80,
    status: 'ALLOWED',
    projection: 3327.27,
    daysElapsed: 11,
    daysInMonth: 30,
    ...overrides,
  }
}

describe('formatFetchedAgo()', () => {
  const now = Date.parse('2026-11-11T15:00:00Z')
  it.each([
    [null, 'ainda não consultado na Meta'],
    ['2026-11-11T14:59:40Z', 'agora há pouco'],
    ['2026-11-11T15:00:30Z', 'agora há pouco'],
    ['2026-11-11T14:57:00Z', 'há 3 min'],
    ['2026-11-11T12:00:00Z', 'há 3 h'],
    ['2026-11-10T14:00:00Z', 'há 1 dia'],
    ['2026-11-08T14:00:00Z', 'há 3 dias'],
  ])('%s -> %s', (iso, expected) => {
    expect(formatFetchedAgo(iso, now)).toBe(expected)
  })
})

describe('<WhatsAppSpendCapsCard />', () => {
  it('shows the Meta spend, the source, the cap progress and the status', async () => {
    mockFetch([{ match: URL, data: [status()] }])
    renderWithQuery(<WhatsAppSpendCapsCard workspaceId='ws_1' />)

    expect(await screen.findByText('Fidelizza+')).toBeTruthy()
    expect(screen.getByText('Volume da Meta × tabela')).toBeTruthy()
    expect(screen.getByText('Liberado')).toBeTruthy()
    expect(screen.getByText('Bloquear envios pagos')).toBeTruthy()
    expect(screen.getByText(/Atualizado há 3 min, direto da Meta/)).toBeTruthy()
    expect(screen.getByText(/Marketing: 496 msg/)).toBeTruthy()
    expect(
      screen.getByRole('progressbar', {
        name: 'Consumo do limite de Fidelizza+',
      }),
    ).toBeTruthy()
  })

  it('shows a blocked number, a stale reading and a number without cap', async () => {
    mockFetch([
      {
        match: URL,
        data: [
          status({
            status: 'BLOCKED',
            level: 100,
            percent: 100,
            stale: true,
            staleReason: 'A Meta está instável agora.',
            source: 'META_COST',
          }),
          status({
            connectionId: 'c2',
            label: 'Vendas',
            monthlyCapAmount: null,
            capMode: null,
            status: 'NO_CAP',
            level: null,
            percent: null,
            source: 'STEEL_LEDGER',
            fetchedAt: null,
            byCategory: [],
          }),
          status({
            connectionId: 'c3',
            label: 'Aviso',
            capMode: 'WARN',
            level: null,
            percent: 10,
          }),
        ],
      },
    ])
    renderWithQuery(<WhatsAppSpendCapsCard workspaceId='ws_1' />)

    expect(await screen.findByText('Bloqueado')).toBeTruthy()
    expect(screen.getByText('Custo da Meta')).toBeTruthy()
    expect(screen.getByText(/A Meta está instável agora/)).toBeTruthy()
    expect(screen.getByText('Sem limite')).toBeTruthy()
    expect(screen.getByText('Só registros do Steel')).toBeTruthy()
    expect(screen.getByText(/Ainda não lido na Meta neste mês/)).toBeTruthy()
    expect(screen.getByText('Definir limite')).toBeTruthy()
    expect(screen.getByText(/só avisa ao atingir/)).toBeTruthy()
  })

  it('explains when there is no Meta number and when the read fails', async () => {
    mockFetch([{ match: URL, data: [] }])
    const { unmount } = renderWithQuery(
      <WhatsAppSpendCapsCard workspaceId='ws_1' />,
    )
    expect(
      await screen.findByText(/Nenhum número da API oficial da Meta/),
    ).toBeTruthy()
    unmount()

    mockFetch([{ match: URL, status: 403, error: 'Sem permissão' }])
    renderWithQuery(<WhatsAppSpendCapsCard workspaceId='ws_1' />)
    expect(
      await screen.findByText(/Não foi possível consultar o gasto/),
    ).toBeTruthy()
  })

  it('saves a new cap from the dialog', async () => {
    const spy = mockFetch([
      { match: URL, data: [status()] },
      {
        method: 'PUT',
        match: `${URL}/c1`,
        data: status({ monthlyCapAmount: 2000 }),
      },
    ])
    renderWithQuery(<WhatsAppSpendCapsCard workspaceId='ws_1' />)

    const open = await screen.findByRole('button', { name: 'Alterar limite' })
    fireEvent.click(open)
    fireEvent.change(await screen.findByLabelText('Limite mensal (R$)'), {
      target: { value: '2.000,00' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar limite' }))

    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Limite salvo.'),
    )
    expect(fetchBody(spy, `${URL}/c1`, 'PUT')).toEqual({
      monthlyCapAmount: 2000,
      capMode: 'BLOCK',
    })
  })

  it('removes the cap and refuses an invalid amount', async () => {
    const spy = mockFetch([
      { match: URL, data: [status()] },
      {
        method: 'PUT',
        match: `${URL}/c1`,
        data: status({ monthlyCapAmount: null, status: 'NO_CAP' }),
      },
    ])
    renderWithQuery(<WhatsAppSpendCapsCard workspaceId='ws_1' />)

    const open = await screen.findByRole('button', { name: 'Alterar limite' })
    fireEvent.click(open)
    fireEvent.change(await screen.findByLabelText('Limite mensal (R$)'), {
      target: { value: 'abc' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar limite' }))
    expect(notify.error).toHaveBeenCalledWith(
      'Informe um limite válido (ex.: 1.500,00).',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Remover limite' }))
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Limite removido.'),
    )
    expect(fetchBody(spy, `${URL}/c1`, 'PUT')).toMatchObject({
      monthlyCapAmount: null,
    })
  })

  it('reports a failed save', async () => {
    mockFetch([
      { match: URL, data: [status({ monthlyCapAmount: null, capMode: null })] },
      { method: 'PUT', match: `${URL}/c1`, status: 500, error: 'Falhou' },
    ])
    renderWithQuery(<WhatsAppSpendCapsCard workspaceId='ws_1' />)

    const open = await screen.findByRole('button', { name: 'Definir limite' })
    fireEvent.click(open)
    fireEvent.change(await screen.findByLabelText('Limite mensal (R$)'), {
      target: { value: '1500' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar limite' }))
    await waitFor(() => expect(notify.error).toHaveBeenCalled())
  })
})

describe('<ConnectionSpendCapButton />', () => {
  it('opens the cap dialog from the connection card', async () => {
    mockFetch([{ match: URL, data: [status()] }])
    renderWithQuery(
      <ConnectionSpendCapButton workspaceId='ws_1' connectionId='c1' />,
    )
    fireEvent.click(await screen.findByRole('button', { name: /Limite: R\$/ }))
    expect(await screen.findByText('Limite de gasto — Fidelizza+')).toBeTruthy()
  })

  it('offers to set a cap, and hides itself for others or unknown numbers', async () => {
    mockFetch([
      { match: URL, data: [status({ monthlyCapAmount: null, capMode: null })] },
    ])
    const { unmount } = renderWithQuery(
      <ConnectionSpendCapButton workspaceId='ws_1' connectionId='c1' />,
    )
    expect(
      await screen.findByRole('button', { name: 'Limite de gasto' }),
    ).toBeTruthy()
    unmount()

    mockFetch([{ match: URL, status: 403, error: 'Sem permissão' }])
    const { container } = renderWithQuery(
      <ConnectionSpendCapButton workspaceId='ws_1' connectionId='zz' />,
    )
    await waitFor(() => expect(container.innerHTML).toBe(''))
  })
})
