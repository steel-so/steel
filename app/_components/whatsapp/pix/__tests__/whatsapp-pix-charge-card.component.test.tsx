import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import type { WhatsAppPixChargeDTO } from '@/types/whatsapp-pix'
import { WhatsappPixChargeCard } from '../whatsapp-pix-charge-card'

vi.setConfig({ testTimeout: 20_000 })

const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/notify', () => ({ notify }))

const PIX = '/api/workspaces/ws_1/whatsapp/conversations/cv_1/pix'

function charge(
  overrides: Partial<WhatsAppPixChargeDTO> = {},
): WhatsAppPixChargeDTO {
  return {
    id: 'ch_1',
    conversationId: 'cv_1',
    opportunityId: null,
    createdById: 'u_1',
    createdByAi: false,
    provider: 'mock',
    amount: 150,
    description: 'Mensalidade de novembro',
    brCode: '00020126mockcode6304ABCD',
    status: 'PENDING',
    expiresAt: '2026-11-12T17:30:00.000Z',
    paidAt: null,
    paidAmount: null,
    payerName: null,
    canceledAt: null,
    createdAt: '2026-11-12T16:30:00.000Z',
    ...overrides,
  }
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('<WhatsappPixChargeCard />', () => {
  it('shows value, text and the deadline in São Paulo time', () => {
    renderWithQuery(
      <WhatsappPixChargeCard workspaceId='ws_1' charge={charge()} />,
    )

    expect(screen.getByText(/Cobrança Pix · R\$\s150,00/)).toBeTruthy()
    expect(screen.getByText('Mensalidade de novembro')).toBeTruthy()
    expect(screen.getByText('Aguardando pagamento')).toBeTruthy()
    expect(screen.getByText(/Vale até 12\/11 às 14:30/)).toBeTruthy()
  })

  it('copies the code and toggles the QR', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    renderWithQuery(
      <WhatsappPixChargeCard workspaceId='ws_1' charge={charge()} />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Copiar código/ }))
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('00020126mockcode6304ABCD'),
    )
    expect(notify.success).toHaveBeenCalledWith('Código Pix copiado')

    expect(screen.queryByRole('img', { name: 'QR code do Pix' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Ver QR/ }))
    const qr = screen.getByRole('img', { name: 'QR code do Pix' })
    expect(qr.querySelector('svg')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Esconder QR/ }))
    expect(screen.queryByRole('img', { name: 'QR code do Pix' })).toBeNull()
  })

  it('warns when the clipboard is unavailable', async () => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn(async () => {
          throw new Error('denied')
        }),
      },
    })
    renderWithQuery(
      <WhatsappPixChargeCard workspaceId='ws_1' charge={charge()} />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Copiar código/ }))
    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith(
        'Não foi possível copiar o código',
      ),
    )
  })

  it('cancels a pending charge after confirming', async () => {
    const fetchSpy = mockFetch([
      {
        method: 'DELETE',
        match: `${PIX}/ch_1`,
        data: charge({ status: 'CANCELED' }),
      },
    ])
    renderWithQuery(
      <WhatsappPixChargeCard workspaceId='ws_1' charge={charge()} canManage />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Cancelar cobrança/ }))
    fireEvent.click(
      await screen.findByRole('button', { name: 'Cancelar cobrança' }),
    )

    await waitFor(() =>
      expect(
        fetchSpy.mock.calls.some(
          ([url, init]) =>
            String(url).endsWith(`${PIX}/ch_1`) && init?.method === 'DELETE',
        ),
      ).toBe(true),
    )
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Cobrança cancelada'),
    )
  })

  it('reports a failed cancel', async () => {
    mockFetch([
      {
        method: 'DELETE',
        match: `${PIX}/ch_1`,
        status: 409,
        error: 'Só uma cobrança aguardando pagamento pode ser cancelada',
      },
    ])
    renderWithQuery(
      <WhatsappPixChargeCard workspaceId='ws_1' charge={charge()} canManage />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Cancelar cobrança/ }))
    fireEvent.click(
      await screen.findByRole('button', { name: 'Cancelar cobrança' }),
    )
    await waitFor(() => expect(notify.error).toHaveBeenCalled())
  })

  it('simulates the payment for test providers', async () => {
    const fetchSpy = mockFetch([
      {
        method: 'POST',
        match: `${PIX}/ch_1/simulate-payment`,
        data: charge({ status: 'PAID' }),
      },
    ])
    renderWithQuery(
      <WhatsappPixChargeCard
        workspaceId='ws_1'
        charge={charge()}
        canSimulate
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Simular pagamento' }))
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Pagamento simulado'),
    )
    expect(fetchBody(fetchSpy, `${PIX}/ch_1/simulate-payment`, 'POST')).toBe(
      undefined,
    )
  })

  it('reports a failed simulation', async () => {
    mockFetch([
      {
        method: 'POST',
        match: `${PIX}/ch_1/simulate-payment`,
        status: 403,
        error: 'Permissão insuficiente',
      },
    ])
    renderWithQuery(
      <WhatsappPixChargeCard
        workspaceId='ws_1'
        charge={charge()}
        canSimulate
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Simular pagamento' }))
    await waitFor(() => expect(notify.error).toHaveBeenCalled())
  })

  it('hides the actions unless allowed, and from a settled charge', () => {
    const { rerender } = renderWithQuery(
      <WhatsappPixChargeCard workspaceId='ws_1' charge={charge()} />,
    )
    expect(
      screen.queryByRole('button', { name: /Cancelar cobrança/ }),
    ).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'Simular pagamento' }),
    ).toBeNull()

    rerender(
      <WhatsappPixChargeCard
        workspaceId='ws_1'
        charge={charge({ status: 'PAID', paidAt: '2026-11-12T16:45:00.000Z' })}
        canManage
        canSimulate
      />,
    )
    expect(screen.queryByRole('button', { name: /Copiar código/ })).toBeNull()
    expect(
      screen.queryByRole('button', { name: /Cancelar cobrança/ }),
    ).toBeNull()
  })

  it('describes paid, canceled and expired charges', () => {
    const { rerender } = renderWithQuery(
      <WhatsappPixChargeCard
        workspaceId='ws_1'
        charge={charge({
          status: 'PAID',
          paidAt: '2026-11-12T16:45:00.000Z',
          paidAmount: 140,
          payerName: 'Maria Souza',
        })}
      />,
    )
    expect(screen.getByText('Pago')).toBeTruthy()
    expect(
      screen.getByText(/Pago em 12\/11 às 13:45 por Maria Souza/),
    ).toBeTruthy()
    expect(screen.getByText(/valor recebido R\$\s140,00/)).toBeTruthy()

    rerender(
      <WhatsappPixChargeCard
        workspaceId='ws_1'
        charge={charge({
          status: 'CANCELED',
          canceledAt: '2026-11-12T16:40:00.000Z',
        })}
      />,
    )
    expect(screen.getByText('Cancelada')).toBeTruthy()
    expect(screen.getByText(/Cancelada em 12\/11 às 13:40/)).toBeTruthy()

    rerender(
      <WhatsappPixChargeCard
        workspaceId='ws_1'
        charge={charge({ status: 'EXPIRED', createdByAi: true })}
      />,
    )
    expect(screen.getByText('Vencida')).toBeTruthy()
    expect(screen.getByText(/Venceu em 12\/11 às 14:30/)).toBeTruthy()
    expect(screen.getByText(/enviada pela IA/)).toBeTruthy()
  })
})
