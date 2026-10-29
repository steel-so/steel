import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import type { WhatsAppPixSettingsDTO } from '@/types/whatsapp-pix'
import { WhatsappPixChargeDialog } from '../whatsapp-pix-charge-dialog'

vi.setConfig({ testTimeout: 20_000 })

const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/notify', () => ({ notify }))

const API = '/api/workspaces/ws_1'
const PIX = `${API}/whatsapp/conversations/cv_1/pix`

const settings: WhatsAppPixSettingsDTO = {
  workspaceId: 'ws_1',
  enabled: true,
  defaultExpiresMinutes: 60,
  provider: 'mock',
  isTestProvider: true,
}

function setup(extra: Parameters<typeof mockFetch>[0] = []) {
  const onOpenChange = vi.fn()
  const fetchSpy = mockFetch([
    ...extra,
    { method: 'POST', match: PIX, data: { id: 'ch_1' } },
    {
      match: `${API}/crm/opportunities`,
      data: [
        { id: 'op_1', name: 'Plano anual', amount: 10 },
        { id: 'op_2', name: 'Upgrade', amount: 5 },
      ],
    },
  ])
  renderWithQuery(
    <WhatsappPixChargeDialog
      workspaceId='ws_1'
      conversationId='cv_1'
      settings={settings}
      open
      onOpenChange={onOpenChange}
    />,
  )
  return { fetchSpy, onOpenChange }
}

describe('<WhatsappPixChargeDialog />', () => {
  it('sends the charge with the typed amount in reais and the default validity', async () => {
    const { fetchSpy, onOpenChange } = setup()

    expect(await screen.findByText(/Provedor de teste/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Valor (R$)'), {
      target: { value: '1.234,50' },
    })
    fireEvent.change(screen.getByLabelText('O que está sendo cobrado'), {
      target: { value: '  Mensalidade  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar cobrança' }))

    await waitFor(() =>
      expect(fetchBody(fetchSpy, PIX, 'POST')).toEqual({
        amount: 1234.5,
        description: 'Mensalidade',
        expiresInMinutes: 60,
      }),
    )
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Cobrança Pix enviada'),
    )
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('offers the CRM deals to link the charge to', async () => {
    setup()
    expect(await screen.findByLabelText('Oportunidade do CRM')).toBeTruthy()
  })

  it('does not offer deals without CRM access', async () => {
    const { fetchSpy } = setup([
      { match: `${API}/crm/opportunities`, status: 403, error: 'Sem acesso' },
    ])
    await screen.findByLabelText('Valor (R$)')
    await waitFor(() =>
      expect(
        fetchSpy.mock.calls.some(([url]) =>
          String(url).includes('/crm/opportunities'),
        ),
      ).toBe(true),
    )
    expect(screen.queryByLabelText('Oportunidade do CRM')).toBeNull()
  })

  it('refuses an invalid amount and an empty description before calling the API', async () => {
    const { fetchSpy } = setup()
    await screen.findByLabelText('Valor (R$)')

    fireEvent.change(screen.getByLabelText('O que está sendo cobrado'), {
      target: { value: 'Algo' },
    })
    fireEvent.change(screen.getByLabelText('Valor (R$)'), {
      target: { value: 'abc' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar cobrança' }))
    expect(notify.error).toHaveBeenCalledWith(
      'Informe um valor válido, por exemplo 150,00',
    )

    fireEvent.change(screen.getByLabelText('Valor (R$)'), {
      target: { value: '10' },
    })
    fireEvent.change(screen.getByLabelText('O que está sendo cobrado'), {
      target: { value: '   ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar cobrança' }))
    expect(notify.error).toHaveBeenCalledWith(
      'Descreva o que está sendo cobrado',
    )
    expect(
      fetchSpy.mock.calls.some(([, init]) => init?.method === 'POST'),
    ).toBe(false)
  })

  it('keeps the dialog open and reports a server refusal', async () => {
    const { onOpenChange } = setup([
      {
        method: 'POST',
        match: PIX,
        status: 422,
        error: 'O Pix na conversa está desligado',
      },
    ])
    fireEvent.change(await screen.findByLabelText('Valor (R$)'), {
      target: { value: '10' },
    })
    fireEvent.change(screen.getByLabelText('O que está sendo cobrado'), {
      target: { value: 'Taxa' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar cobrança' }))

    await waitFor(() => expect(notify.error).toHaveBeenCalled())
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it('closes on cancel', async () => {
    const { onOpenChange } = setup()
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
