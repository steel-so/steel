import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import { ChatbotSimulator } from '../chatbot-simulator'

vi.setConfig({ testTimeout: 20_000 })

const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/notify', () => ({ notify }))

const URL = '/api/workspaces/ws_1/whatsapp/chatbots/bot_1/simulate'

const menuStep = {
  state: { started: true, awaiting: { kind: 'menu' }, variables: {} },
  outputs: [
    { kind: 'text', text: 'Olá, Cliente!' },
    {
      kind: 'menu',
      nodeId: 'menu',
      text: 'Como podemos ajudar?',
      buttons: [{ id: 'bot:menu:sales', label: 'Comercial' }],
      list: null,
      numbered: 'Como podemos ajudar?\n\n1. Comercial',
    },
  ],
  status: 'WAITING',
  handoff: null,
  closeConversation: false,
}

describe('<ChatbotSimulator />', () => {
  it('starts the flow and renders text and menu buttons', async () => {
    const spy = mockFetch([{ method: 'POST', match: URL, data: menuStep }])
    renderWithQuery(<ChatbotSimulator workspaceId='ws_1' chatbotId='bot_1' />)

    expect(await screen.findByText('Olá, Cliente!')).toBeTruthy()
    expect(screen.getByText('Como podemos ajudar?')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Comercial' })).toBeTruthy()
    expect(fetchBody(spy, URL)).toMatchObject({ input: 'Olá' })
  })

  it('shows where a form goes out', async () => {
    mockFetch([
      {
        method: 'POST',
        match: URL,
        data: {
          state: { started: true, awaiting: null, variables: {} },
          outputs: [
            {
              kind: 'form',
              nodeId: 'f',
              flowId: 'flow-1',
              bodyText: 'Preencha',
            },
            { kind: 'form', nodeId: 'g', flowId: 'flow-2' },
          ],
          status: 'COMPLETED',
          handoff: null,
          closeConversation: false,
        },
      },
    ])
    renderWithQuery(<ChatbotSimulator workspaceId='ws_1' chatbotId='bot_1' />)

    expect(
      await screen.findByText('Formulário do WhatsApp: Preencha'),
    ).toBeTruthy()
    expect(
      screen.getByText(
        'Formulário do WhatsApp: o contato recebe o formulário para preencher.',
      ),
    ).toBeTruthy()
  })

  it('sends the tapped button with the previous state and shows the end', async () => {
    const spy = mockFetch([
      {
        method: 'POST',
        match: URL,
        handler: (_url, init) => {
          const body = JSON.parse(String(init?.body))
          return body.state
            ? {
                state: { started: true, awaiting: null, variables: {} },
                outputs: [
                  { kind: 'text', text: 'Um consultor vai falar com você.' },
                ],
                status: 'HANDED_OFF_HUMAN',
                handoff: {},
                closeConversation: false,
              }
            : menuStep
        },
      },
    ])
    renderWithQuery(<ChatbotSimulator workspaceId='ws_1' chatbotId='bot_1' />)

    fireEvent.click(await screen.findByRole('button', { name: 'Comercial' }))

    expect(
      await screen.findByText('Um consultor vai falar com você.'),
    ).toBeTruthy()
    expect(screen.getByText('Passou para atendente')).toBeTruthy()
    const second = JSON.parse(String(spy.mock.calls[1][1]?.body))
    expect(second.input).toBe('bot:menu:sales')
    expect(second.state.started).toBe(true)
    expect(
      (screen.getByLabelText('Mensagem do contato') as HTMLInputElement)
        .disabled,
    ).toBe(true)
  })

  it('sends typed text and restarts', async () => {
    const spy = mockFetch([{ method: 'POST', match: URL, data: menuStep }])
    renderWithQuery(<ChatbotSimulator workspaceId='ws_1' chatbotId='bot_1' />)
    await screen.findByText('Olá, Cliente!')

    fireEvent.change(screen.getByLabelText('Mensagem do contato'), {
      target: { value: '1' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
    await waitFor(() => expect(spy.mock.calls.length).toBe(2))
    expect(JSON.parse(String(spy.mock.calls[1][1]?.body)).input).toBe('1')

    fireEvent.click(screen.getByRole('button', { name: 'Reiniciar' }))
    await waitFor(() => expect(spy.mock.calls.length).toBe(3))
    expect(JSON.parse(String(spy.mock.calls[2][1]?.body)).state).toBeUndefined()
  })

  it('reports a failed simulation', async () => {
    mockFetch([{ method: 'POST', match: URL, status: 500, error: 'Falhou' }])
    renderWithQuery(<ChatbotSimulator workspaceId='ws_1' chatbotId='bot_1' />)
    await waitFor(() => expect(notify.error).toHaveBeenCalledWith('Falhou'))
  })

  it('shows the rows of an interactive list as tappable options', async () => {
    const listStep = {
      ...menuStep,
      outputs: [
        {
          kind: 'menu',
          nodeId: 'menu',
          text: 'Escolha uma área',
          buttons: null,
          list: {
            buttonLabel: 'Ver opções',
            rows: [
              { id: 'bot:menu:a', label: 'Financeiro' },
              { id: 'bot:menu:b', label: 'Suporte' },
              { id: 'bot:menu:c', label: 'Vendas' },
              { id: 'bot:menu:d', label: 'Outros' },
            ],
          },
          numbered: 'Escolha uma área\n\n1. Financeiro',
        },
      ],
    }
    mockFetch([{ method: 'POST', match: URL, data: listStep }])
    renderWithQuery(<ChatbotSimulator workspaceId='ws_1' chatbotId='bot_1' />)

    expect(await screen.findByText('Escolha uma área')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Financeiro' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Outros' })).toBeTruthy()
  })
})
