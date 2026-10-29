import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import { FlowSendDialog } from '../flow-send-dialog'

vi.setConfig({ testTimeout: 20_000 })

const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/notify', () => ({ notify }))

const BASE = '/api/workspaces/ws_1/whatsapp/flows'

const flow = (overrides = {}) => ({
  id: 'flow_1',
  name: 'Cadastro',
  status: 'PUBLISHED',
  bodyText: 'Preencha o cadastro',
  ctaLabel: 'Cadastrar',
  sendable: true,
  sent: 0,
  completed: 0,
  ...overrides,
})

describe('<FlowSendDialog />', () => {
  it('sends the chosen flow into the conversation', async () => {
    const spy = mockFetch([
      {
        method: 'POST',
        match: `${BASE}/flow_1/send`,
        status: 201,
        data: { messageId: 'm1', responseId: 'r1' },
      },
      {
        match: BASE,
        data: [
          flow(),
          flow({ id: 'flow_2', sendable: false, name: 'Rascunho' }),
        ],
      },
    ])
    const onOpenChange = vi.fn()
    renderWithQuery(
      <FlowSendDialog
        workspaceId='ws_1'
        conversationId='conv_1'
        open
        onOpenChange={onOpenChange}
      />,
    )

    fireEvent.click(await screen.findByRole('combobox', { name: 'Formulário' }))
    // The one that is not sendable is not offered.
    expect(screen.queryByRole('option', { name: /Rascunho/ })).toBeNull()
    fireEvent.click(await screen.findByRole('option', { name: 'Cadastro' }))
    expect(await screen.findByText(/Preencha o cadastro/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Enviar formulário' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(fetchBody(spy, '/flow_1/send', 'POST')).toEqual({
      conversationId: 'conv_1',
    })
    expect(notify.success).toHaveBeenCalledWith('Formulário enviado')
  })

  it('labels a flow that is only a Meta draft', async () => {
    mockFetch([
      { match: BASE, data: [flow({ status: 'DRAFT', name: 'Teste' })] },
    ])
    renderWithQuery(
      <FlowSendDialog
        workspaceId='ws_1'
        conversationId='conv_1'
        open
        onOpenChange={vi.fn()}
      />,
    )
    fireEvent.click(await screen.findByRole('combobox', { name: 'Formulário' }))
    expect(
      await screen.findByRole('option', { name: 'Teste (rascunho na Meta)' }),
    ).toBeTruthy()
  })

  it('keeps send disabled until a flow is chosen and explains an empty list', async () => {
    mockFetch([{ match: BASE, data: [] }])
    renderWithQuery(
      <FlowSendDialog
        workspaceId='ws_1'
        conversationId='conv_1'
        open
        onOpenChange={vi.fn()}
      />,
    )
    expect(await screen.findByText(/Nenhum formulário publicado/)).toBeTruthy()
    expect(
      (
        screen.getByRole('button', {
          name: 'Enviar formulário',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
  })

  it('shows the error when the send fails', async () => {
    mockFetch([
      {
        method: 'POST',
        match: `${BASE}/flow_1/send`,
        status: 409,
        error: 'Fora da janela',
      },
      { match: BASE, data: [flow()] },
    ])
    const onOpenChange = vi.fn()
    renderWithQuery(
      <FlowSendDialog
        workspaceId='ws_1'
        conversationId='conv_1'
        open
        onOpenChange={onOpenChange}
      />,
    )
    fireEvent.click(await screen.findByRole('combobox', { name: 'Formulário' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Cadastro' }))
    fireEvent.click(screen.getByRole('button', { name: 'Enviar formulário' }))
    await waitFor(() => expect(notify.error).toHaveBeenCalled())
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('renders nothing inside when closed', () => {
    mockFetch([{ match: BASE, data: [] }])
    renderWithQuery(
      <FlowSendDialog
        workspaceId='ws_1'
        conversationId='conv_1'
        open={false}
        onOpenChange={vi.fn()}
      />,
    )
    expect(screen.queryByText('Enviar formulário')).toBeNull()
  })
})
