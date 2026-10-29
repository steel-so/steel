import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  type WebPhoneApi,
  WebPhoneContext,
} from '@/app/_components/webphone/webphone-context'
import {
  type FetchRoute,
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import type { WhatsAppConversationDTO } from '@/types/whatsapp-conversation'
import type { WhatsAppMessageDTO } from '@/types/whatsapp-message'
import { WhatsappConversationView } from '../whatsapp-conversation-view'

// Dialog/select flows render Base UI portals and wait on several fetches;
// the project default (5s) is too tight when the suite runs under load.
vi.setConfig({ testTimeout: 20_000 })

const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/notify', () => ({ notify }))
// `useUser` only fires once Better Auth reports a session.
vi.mock('@/src/lib/auth-client', () => ({
  authClient: { useSession: () => ({ data: { user: { id: 'u_1' } } }) },
}))

// The composer has its own suite; here we only care about what the view
// hands it (disabled state and reply target).
vi.mock('../whatsapp-composer', () => ({
  WhatsappComposer: (props: {
    disabled?: boolean
    replyTarget: WhatsAppMessageDTO | null
    contactName: string
  }) => (
    <div
      data-testid='composer'
      data-disabled={String(Boolean(props.disabled))}
      data-reply={props.replyTarget?.id ?? ''}
      data-contact={props.contactName}
    />
  ),
}))
vi.mock('../whatsapp-video-call-dialog', () => ({
  WhatsappVideoCallDialog: (props: { open: boolean; roomName: string }) =>
    props.open ? <div data-testid='video-call'>{props.roomName}</div> : null,
}))

const API = '/api/workspaces/ws_1/whatsapp'
const MESSAGES = `${API}/conversations/cv_1/messages`

function conversation(
  overrides: Partial<WhatsAppConversationDTO> = {},
): WhatsAppConversationDTO {
  return {
    id: 'cv_1',
    workspaceId: 'ws_1',
    connectionId: 'conn_1',
    contactId: 'c1',
    contactName: 'Ana Souza',
    contactWaId: '5511911111111',
    contactUsername: null,
    contactHasPhone: true,
    contactAvatarUrl: null,
    status: 'IN_PROGRESS',
    assignedUserId: 'u_2',
    teamId: null,
    team: null,
    aiActive: false,
    aiHandoff: false,
    unreadCount: 0,
    avgSentimentScore: null,
    lastMessageAt: null,
    lastMessagePreview: null,
    pinned: false,
    archived: false,
    closedAt: null,
    closeReason: null,
    closeOutcome: null,
    closeStatusIds: [],
    closeStatusLabels: [],
    contactSince: '2025-03-10T12:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function message(overrides: Partial<WhatsAppMessageDTO>): WhatsAppMessageDTO {
  return {
    id: 'm1',
    workspaceId: 'ws_1',
    conversationId: 'cv_1',
    direction: 'IN',
    type: 'TEXT',
    text: 'Olá!',
    mediaUrl: null,
    status: 'DELIVERED',
    senderUserId: null,
    sentByAi: false,
    replyToMessageId: null,
    reactionEmoji: null,
    reactedByContact: null,
    contactPayload: null,
    buttons: null,
    buttonPayload: null,
    createdAt: '2026-01-01T12:00:00.000Z',
    ...overrides,
  }
}

const thread = [
  message({ id: 'm1', text: 'Preciso de ajuda com meu pedido' }),
  message({
    id: 'm2',
    direction: 'OUT',
    text: 'Claro! Qual o número?',
    sentByAi: true,
    status: 'READ',
    reactionEmoji: '👍',
  }),
  message({
    id: 'm3',
    direction: 'OUT',
    text: 'Não chegou',
    status: 'FAILED',
  }),
  message({
    id: 'm4',
    type: 'CONTACT',
    text: null,
    contactPayload: { name: 'Carlos Lima', waId: '5531977776666' },
  }),
]

const members = [
  { id: 'u_1', name: 'Eu Mesmo', email: 'eu@x.com', image: null },
  { id: 'u_2', name: 'Beatriz', email: 'bia@x.com', image: null },
]

function setup(extra: FetchRoute[] = [], messages = thread) {
  return mockFetch([
    ...extra,
    { match: MESSAGES, data: messages },
    { match: `${API}/conversations/cv_1/events`, data: [] },
    { match: `${API}/assignable-members`, data: members },
    {
      match: `${API}/close-statuses`,
      data: { statuses: [], minSelections: 0, maxSelections: 1 },
    },
    { match: '/api/users/me', data: { id: 'u_1', name: 'Eu Mesmo' } },
  ])
}

describe('<WhatsappConversationView />', () => {
  it('goes back to the list from the header below lg', () => {
    setup()
    const onBack = vi.fn()
    const { rerender } = renderWithQuery(
      <WhatsappConversationView
        workspaceId='ws_1'
        conversation={conversation()}
        onSelectConversation={vi.fn()}
        onBack={onBack}
      />,
    )
    const back = screen.getByRole('button', {
      name: 'Voltar para as conversas',
    })
    expect(back.className).toContain('lg:hidden')
    fireEvent.click(back)
    expect(onBack).toHaveBeenCalledTimes(1)

    rerender(
      <WhatsappConversationView
        workspaceId='ws_1'
        conversation={conversation()}
        onSelectConversation={vi.fn()}
      />,
    )
    expect(
      screen.queryByRole('button', { name: 'Voltar para as conversas' }),
    ).toBeNull()
  })

  it('closes the conversation with an optional reason', async () => {
    const onSelectConversation = vi.fn()
    const fetchSpy = setup([
      {
        method: 'POST',
        match: `${API}/conversations/cv_1/close`,
        data: conversation({ status: 'CLOSED', closeReason: 'Resolvido' }),
      },
    ])
    renderWithQuery(
      <WhatsappConversationView
        workspaceId='ws_1'
        conversation={conversation()}
        onSelectConversation={onSelectConversation}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }))
    fireEvent.change(await screen.findByLabelText('Motivo (opcional)'), {
      target: { value: 'Resolvido' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Fechar conversa' }))

    await waitFor(() =>
      expect(onSelectConversation).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'CLOSED' }),
      ),
    )
    expect(
      fetchBody(fetchSpy, `${API}/conversations/cv_1/close`, 'POST'),
    ).toEqual({ reason: 'Resolvido', statusIds: [] })
  })

  it('locks the composer outside business hours and says when it opens', async () => {
    setup([
      {
        match: `${API}/business-hours`,
        data: {
          enabled: true,
          start: '08:00',
          end: '18:00',
          days: [1, 2, 3, 4, 5],
          open: false,
          nextOpeningAt: '2026-10-21T11:00:00.000Z',
        },
      },
    ])
    renderWithQuery(
      <WhatsappConversationView
        workspaceId='ws_1'
        conversation={conversation()}
        onSelectConversation={vi.fn()}
      />,
    )

    expect(
      await screen.findByText(/Fora do horário de atendimento/),
    ).toBeTruthy()
    await waitFor(() =>
      expect(screen.getByTestId('composer').dataset.disabled).toBe('true'),
    )
  })

  it('requires the close statuses the workspace asks for', async () => {
    const onSelectConversation = vi.fn()
    const fetchSpy = setup([
      {
        match: `${API}/close-statuses`,
        data: {
          statuses: [
            {
              id: 'st_1',
              label: 'Venda realizada',
              outcome: 'SUCCESS',
              position: 0,
            },
            {
              id: 'st_2',
              label: 'Sem interesse',
              outcome: 'FAILURE',
              position: 1,
            },
          ],
          minSelections: 1,
          maxSelections: 1,
        },
      },
      {
        method: 'POST',
        match: `${API}/conversations/cv_1/close`,
        data: conversation({ status: 'CLOSED', closeOutcome: 'FAILURE' }),
      },
    ])
    renderWithQuery(
      <WhatsappConversationView
        workspaceId='ws_1'
        conversation={conversation()}
        onSelectConversation={onSelectConversation}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }))
    const submit = await screen.findByRole('button', {
      name: 'Fechar conversa',
    })
    await screen.findByText('Sem interesse')
    expect((submit as HTMLButtonElement).disabled).toBe(true)

    // Single choice: the second pick replaces the first.
    fireEvent.click(screen.getByRole('checkbox', { name: /Venda realizada/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Sem interesse/ }))
    expect((submit as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(submit)

    await waitFor(() => expect(onSelectConversation).toHaveBeenCalled())
    expect(
      fetchBody(fetchSpy, `${API}/conversations/cv_1/close`, 'POST'),
    ).toEqual({ statusIds: ['st_2'] })
  })

  it('shows a closed conversation with its timeline and lets the agent reopen it', async () => {
    const onSelectConversation = vi.fn()
    const fetchSpy = mockFetch([
      {
        method: 'POST',
        match: `${API}/conversations/cv_1/reopen`,
        data: conversation({ status: 'IN_PROGRESS' }),
      },
      { match: MESSAGES, data: [message({ id: 'm1', text: 'Obrigada!' })] },
      {
        match: `${API}/conversations/cv_1/events`,
        data: [
          {
            id: 'ev1',
            conversationId: 'cv_1',
            kind: 'CLOSED',
            source: 'AGENT',
            actorUserId: 'u_2',
            actorName: 'Beatriz',
            reason: 'Resolvido',
            createdAt: '2026-01-01T13:00:00.000Z',
          },
        ],
      },
      { match: `${API}/assignable-members`, data: members },
      { match: '/api/users/me', data: { id: 'u_1', name: 'Eu Mesmo' } },
    ])
    renderWithQuery(
      <WhatsappConversationView
        workspaceId='ws_1'
        conversation={conversation({
          status: 'CLOSED',
          closeReason: 'Resolvido',
          aiActive: true,
        })}
        onSelectConversation={onSelectConversation}
      />,
    )

    expect(await screen.findByText(/Conversa fechada por Beatriz/)).toBeTruthy()
    expect(screen.getByText('Motivo: Resolvido')).toBeTruthy()
    // Fechada: composer travado e sem banner da IA.
    expect(screen.getByTestId('composer').dataset.disabled).toBe('true')
    expect(
      screen.queryByRole('button', { name: /Remover do atendimento/i }),
    ).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Reabrir' }))
    await waitFor(() =>
      expect(onSelectConversation).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'IN_PROGRESS' }),
      ),
    )
    expect(
      fetchSpy.mock.calls.some(([url]) =>
        String(url).endsWith('/conversations/cv_1/reopen'),
      ),
    ).toBe(true)
  })

  it('renders the contact header and the message thread', async () => {
    setup()
    renderWithQuery(
      <WhatsappConversationView
        workspaceId='ws_1'
        conversation={conversation()}
      />,
    )

    expect(screen.getByText('Ana Souza')).toBeTruthy()
    expect(
      await screen.findByText('Preciso de ajuda com meu pedido'),
    ).toBeTruthy()
    expect(screen.getByText('Claro! Qual o número?')).toBeTruthy()
    // AI-sent marker, reaction and failed delivery are surfaced.
    expect(screen.getByText('IA')).toBeTruthy()
    expect(screen.getByText('👍')).toBeTruthy()
    expect(screen.getByText('Falhou')).toBeTruthy()
    expect(screen.getByText('Carlos Lima')).toBeTruthy()
    expect(screen.getByTestId('composer').dataset.disabled).toBe('false')
    expect(screen.getByTestId('composer').dataset.contact).toBe('Ana Souza')
  })

  it('marks the conversation as read only when it has unread messages', async () => {
    const fetchSpy = setup([
      { method: 'POST', match: `${API}/conversations/cv_1/read`, data: {} },
    ])
    const { unmount } = renderWithQuery(
      <WhatsappConversationView
        workspaceId='ws_1'
        conversation={conversation({ unreadCount: 2 })}
      />,
    )
    await waitFor(() =>
      expect(
        fetchSpy.mock.calls.some(([url]) => String(url).endsWith('/read')),
      ).toBe(true),
    )
    unmount()

    const second = setup()
    renderWithQuery(
      <WhatsappConversationView
        workspaceId='ws_1'
        conversation={conversation({ unreadCount: 0 })}
      />,
    )
    await screen.findByText('Preciso de ajuda com meu pedido')
    expect(
      second.mock.calls.some(([url]) => String(url).endsWith('/read')),
    ).toBe(false)
  })

  it('locks the composer while the AI is handling and lets the agent take over', async () => {
    const fetchSpy = setup([
      { method: 'PATCH', match: `${API}/conversations/cv_1/ai`, data: {} },
    ])
    renderWithQuery(
      <WhatsappConversationView
        workspaceId='ws_1'
        conversation={conversation({ aiActive: true })}
      />,
    )

    expect(screen.getByTestId('composer').dataset.disabled).toBe('true')
    expect(screen.queryByText(/transferida para atendimento humano/)).toBeNull()
    fireEvent.click(
      screen.getByRole('button', { name: 'Remover do atendimento da IA' }),
    )
    await waitFor(() =>
      expect(
        fetchSpy.mock.calls.some(
          ([url, init]) =>
            init?.method === 'PATCH' &&
            String(url).endsWith('/conversations/cv_1/ai'),
        ),
      ).toBe(true),
    )
  })

  it('shows the handoff banner and resumes the AI', async () => {
    const fetchSpy = setup([
      {
        method: 'PATCH',
        match: `${API}/conversations/cv_1/ai/resume`,
        data: {},
      },
    ])
    renderWithQuery(
      <WhatsappConversationView
        workspaceId='ws_1'
        conversation={conversation({ aiHandoff: true })}
      />,
    )

    expect(screen.queryByText(/A IA está atendendo/)).toBeNull()
    fireEvent.click(
      screen.getByRole('button', { name: 'Retomar atendimento da IA' }),
    )
    await waitFor(() =>
      expect(
        fetchSpy.mock.calls.some(([url]) => String(url).endsWith('/ai/resume')),
      ).toBe(true),
    )
  })

  it('transfers the conversation to another member', async () => {
    const fetchSpy = setup([
      {
        method: 'PATCH',
        match: `${API}/conversations/cv_1/assign`,
        data: conversation(),
      },
    ])
    renderWithQuery(
      <WhatsappConversationView
        workspaceId='ws_1'
        conversation={conversation()}
      />,
    )
    await screen.findByText('Preciso de ajuda com meu pedido')

    fireEvent.click(screen.getByRole('button', { name: 'Transferir conversa' }))
    const menu = await screen.findByRole('menu')
    const me = await within(menu).findByRole('menuitem', {
      name: 'Eu Mesmo (você)',
    })
    // The current assignee cannot be picked again.
    expect(
      within(menu)
        .getByRole('menuitem', { name: 'Beatriz' })
        .getAttribute('aria-disabled'),
    ).toBe('true')

    fireEvent.click(me)
    await waitFor(() =>
      expect(
        fetchBody(fetchSpy, `${API}/conversations/cv_1/assign`, 'PATCH'),
      ).toEqual({ assignedUserId: 'u_1' }),
    )
  })

  it('shows a placeholder when nobody can receive the conversation', async () => {
    mockFetch([
      { match: MESSAGES, data: [] },
      { match: `${API}/assignable-members`, data: [] },
      { match: '/api/users/me', data: { id: 'u_1', name: 'Eu' } },
    ])
    renderWithQuery(
      <WhatsappConversationView
        workspaceId='ws_1'
        conversation={conversation()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Transferir conversa' }))
    const menu = await screen.findByRole('menu')
    expect(
      await within(menu).findByText('Nenhum membro disponível'),
    ).toBeTruthy()
  })

  it('starts a conversation with a shared contact card', async () => {
    const started = conversation({ id: 'cv_new', contactName: 'Carlos Lima' })
    const fetchSpy = setup([
      {
        method: 'POST',
        match: `${API}/contacts/find-or-create`,
        data: { id: 'c9' },
      },
      { method: 'POST', match: `${API}/conversations`, data: started },
    ])
    const onSelectConversation = vi.fn()
    renderWithQuery(
      <WhatsappConversationView
        workspaceId='ws_1'
        conversation={conversation()}
        onSelectConversation={onSelectConversation}
      />,
    )

    fireEvent.click(
      await screen.findByRole('button', { name: /Iniciar conversa/ }),
    )
    await waitFor(() =>
      expect(onSelectConversation).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'cv_new' }),
      ),
    )
    expect(fetchBody(fetchSpy, `${API}/contacts/find-or-create`)).toEqual({
      name: 'Carlos Lima',
      waId: '5531977776666',
    })
    expect(fetchBody(fetchSpy, /\/whatsapp\/conversations$/)).toEqual({
      contactId: 'c9',
      connectionId: 'conn_1',
    })
  })

  it('sends a video call link and opens the call', async () => {
    const fetchSpy = setup([{ method: 'POST', match: MESSAGES, data: {} }])
    renderWithQuery(
      <WhatsappConversationView
        workspaceId='ws_1'
        conversation={conversation()}
      />,
    )

    fireEvent.click(
      screen.getByRole('button', { name: 'Iniciar chamada de vídeo' }),
    )
    expect(await screen.findByTestId('video-call')).toBeTruthy()
    expect(fetchBody(fetchSpy, MESSAGES).text).toContain(
      'https://meet.jit.si/steel-cv_1',
    )
  })

  it('reports an error and keeps the call closed when the link fails to send', async () => {
    setup([{ method: 'POST', match: MESSAGES, status: 502, error: 'falhou' }])
    renderWithQuery(
      <WhatsappConversationView
        workspaceId='ws_1'
        conversation={conversation()}
      />,
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Iniciar chamada de vídeo' }),
    )
    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith('Erro ao iniciar chamada'),
    )
    expect(screen.queryByTestId('video-call')).toBeNull()
  })

  it('places a PABX call and shows its live status', async () => {
    const fetchSpy = setup([
      {
        match: '/api/users/me',
        data: {
          id: 'u_1',
          name: 'Eu',
          pabxExtension: '200',
          pabxDeviceId: '0',
        },
      },
      {
        method: 'POST',
        match: `${API}/conversations/cv_1/call`,
        data: {
          id: 'call_1',
          conversationId: 'cv_1',
          userId: 'u_1',
          extension: '200',
          destination: '11999999999',
          status: 'QUEUED',
          answeredAt: null,
          endedAt: null,
          durationSeconds: null,
          createdAt: new Date().toISOString(),
        },
      },
      { match: `${API}/conversations/cv_1/call`, data: null },
    ])
    renderWithQuery(
      <WhatsappConversationView
        workspaceId='ws_1'
        conversation={conversation()}
      />,
    )

    const call = screen.getByRole('button', { name: 'Ligar para o contato' })
    await waitFor(() =>
      expect(call.getAttribute('title')).toBe('Ligar pelo ramal 200'),
    )
    fireEvent.click(call)

    expect(await screen.findByText('Chamando seu ramal 200…')).toBeTruthy()
    expect(notify.success).toHaveBeenCalledWith(
      'Atenda o ramal 200 para falar com o contato.',
    )
    expect(
      fetchSpy.mock.calls.some(
        ([url, init]) =>
          String(url).endsWith('/conversations/cv_1/call') &&
          init?.method === 'POST',
      ),
    ).toBe(true)
  })

  it('asks for the extension and device before calling', async () => {
    const fetchSpy = setup([
      { match: `${API}/conversations/cv_1/call`, data: null },
    ])
    renderWithQuery(
      <WhatsappConversationView
        workspaceId='ws_1'
        conversation={conversation()}
      />,
    )

    fireEvent.click(
      screen.getByRole('button', { name: 'Ligar para o contato' }),
    )

    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith(
        'Configure seu ramal e device no perfil para ligar.',
      ),
    )
    expect(
      fetchSpy.mock.calls.some(([, init]) => init?.method === 'POST'),
    ).toBe(false)
  })

  it('reports a PABX refusal', async () => {
    setup([
      {
        match: '/api/users/me',
        data: {
          id: 'u_1',
          name: 'Eu',
          pabxExtension: '200',
          pabxDeviceId: '0',
        },
      },
      {
        method: 'POST',
        match: `${API}/conversations/cv_1/call`,
        status: 502,
        error: 'O PABX recusou a ligação: Token ou dispositivo inválido.',
      },
      { match: `${API}/conversations/cv_1/call`, data: null },
    ])
    renderWithQuery(
      <WhatsappConversationView
        workspaceId='ws_1'
        conversation={conversation()}
      />,
    )

    const call = screen.getByRole('button', { name: 'Ligar para o contato' })
    await waitFor(() =>
      expect(call.getAttribute('title')).toBe('Ligar pelo ramal 200'),
    )
    fireEvent.click(call)

    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith(
        'O PABX recusou a ligação: Token ou dispositivo inválido.',
      ),
    )
  })

  it('places a PABX call and shows its live status', async () => {
    const fetchSpy = setup([
      {
        match: '/api/users/me',
        data: {
          id: 'u_1',
          name: 'Eu',
          pabxExtension: '200',
          pabxDeviceId: '0',
        },
      },
      {
        method: 'POST',
        match: `${API}/conversations/cv_1/call`,
        data: {
          id: 'call_1',
          conversationId: 'cv_1',
          userId: 'u_1',
          extension: '200',
          destination: '11999999999',
          status: 'QUEUED',
          answeredAt: null,
          endedAt: null,
          durationSeconds: null,
          createdAt: new Date().toISOString(),
        },
      },
      { match: `${API}/conversations/cv_1/call`, data: null },
    ])
    renderWithQuery(
      <WhatsappConversationView
        workspaceId='ws_1'
        conversation={conversation()}
      />,
    )

    const call = screen.getByRole('button', { name: 'Ligar para o contato' })
    await waitFor(() =>
      expect(call.getAttribute('title')).toBe('Ligar pelo ramal 200'),
    )
    fireEvent.click(call)

    expect(await screen.findByText('Chamando seu ramal 200…')).toBeTruthy()
    expect(notify.success).toHaveBeenCalledWith(
      'Atenda o ramal 200 para falar com o contato.',
    )
    expect(
      fetchSpy.mock.calls.some(
        ([url, init]) =>
          String(url).endsWith('/conversations/cv_1/call') &&
          init?.method === 'POST',
      ),
    ).toBe(true)
  })

  it('asks for the extension and device before calling', async () => {
    const fetchSpy = setup([
      { match: `${API}/conversations/cv_1/call`, data: null },
    ])
    renderWithQuery(
      <WhatsappConversationView
        workspaceId='ws_1'
        conversation={conversation()}
      />,
    )

    fireEvent.click(
      screen.getByRole('button', { name: 'Ligar para o contato' }),
    )

    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith(
        'Configure seu ramal e device no perfil para ligar.',
      ),
    )
    expect(
      fetchSpy.mock.calls.some(([, init]) => init?.method === 'POST'),
    ).toBe(false)
  })

  it('reports a PABX refusal', async () => {
    setup([
      {
        match: '/api/users/me',
        data: {
          id: 'u_1',
          name: 'Eu',
          pabxExtension: '200',
          pabxDeviceId: '0',
        },
      },
      {
        method: 'POST',
        match: `${API}/conversations/cv_1/call`,
        status: 502,
        error: 'O PABX recusou a ligação: Token ou dispositivo inválido.',
      },
      { match: `${API}/conversations/cv_1/call`, data: null },
    ])
    renderWithQuery(
      <WhatsappConversationView
        workspaceId='ws_1'
        conversation={conversation()}
      />,
    )

    const call = screen.getByRole('button', { name: 'Ligar para o contato' })
    await waitFor(() =>
      expect(call.getAttribute('title')).toBe('Ligar pelo ramal 200'),
    )
    fireEvent.click(call)

    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith(
        'O PABX recusou a ligação: Token ou dispositivo inválido.',
      ),
    )
  })

  describe('browser phone', () => {
    const webPhone = (overrides: Partial<WebPhoneApi> = {}): WebPhoneApi => ({
      enabled: true,
      status: 'online',
      error: null,
      call: null,
      recordingNotice: null,
      dial: vi.fn(async () => undefined),
      answer: vi.fn(async () => undefined),
      hangup: vi.fn(async () => undefined),
      toggleMute: vi.fn(),
      sendDtmf: vi.fn(),
      reconnect: vi.fn(),
      ...overrides,
    })

    function renderWith(phone: WebPhoneApi) {
      const fetchSpy = setup([
        {
          match: '/api/users/me',
          data: {
            id: 'u_1',
            name: 'Eu',
            pabxExtension: '1122S',
            pabxDeviceId: '0',
            pabxWebphoneEnabled: true,
          },
        },
        { match: `${API}/conversations/cv_1/call`, data: null },
      ])
      renderWithQuery(
        <WebPhoneContext.Provider value={phone}>
          <WhatsappConversationView
            workspaceId='ws_1'
            conversation={conversation()}
          />
        </WebPhoneContext.Provider>,
      )
      return fetchSpy
    }

    it('calls from the browser instead of asking the PABX to ring the extension', async () => {
      const phone = webPhone()
      const fetchSpy = renderWith(phone)

      const call = screen.getByRole('button', { name: 'Ligar para o contato' })
      await waitFor(() =>
        expect(call.getAttribute('title')).toBe(
          'Ligar pelo telefone web (ramal 1122S)',
        ),
      )
      fireEvent.click(call)

      await waitFor(() => expect(phone.dial).toHaveBeenCalledTimes(1))
      expect(phone.dial).toHaveBeenCalledWith(
        expect.stringMatching(/^\d+$/),
        expect.anything(),
        { conversationId: 'cv_1' },
      )
      expect(
        fetchSpy.mock.calls.some(([, init]) => init?.method === 'POST'),
      ).toBe(false)
    })

    it.each([
      [
        'is open in another tab',
        { status: 'other-tab' as const },
        'O telefone web está aberto em outra aba.',
      ],
      [
        'is still connecting',
        { status: 'connecting' as const },
        'O telefone web ainda está conectando. Tente em instantes.',
      ],
      [
        'lost the connection',
        { status: 'error' as const, error: 'Conexão perdida' },
        'Conexão perdida',
      ],
      [
        'lost the connection without a detail',
        { status: 'offline' as const },
        'O telefone web está sem conexão.',
      ],
    ])('explains when the phone %s', async (_label, patch, message) => {
      const phone = webPhone(patch)
      renderWith(phone)

      fireEvent.click(
        screen.getByRole('button', { name: 'Ligar para o contato' }),
      )

      await waitFor(() => expect(notify.error).toHaveBeenCalledWith(message))
      expect(phone.dial).not.toHaveBeenCalled()
    })

    it('does not start a second call', async () => {
      const phone = webPhone({
        call: {
          direction: 'out',
          number: '1',
          name: null,
          state: 'in-call',
          answeredAt: Date.now(),
          muted: false,
          endReason: null,
        },
      })
      renderWith(phone)

      fireEvent.click(
        screen.getByRole('button', { name: 'Ligar para o contato' }),
      )

      await waitFor(() =>
        expect(notify.error).toHaveBeenCalledWith(
          'Já existe uma ligação em andamento.',
        ),
      )
      expect(phone.dial).not.toHaveBeenCalled()
    })

    it('reports a dial failure', async () => {
      const phone = webPhone({
        dial: vi.fn(async () => {
          throw new Error('Permita o microfone no navegador para ligar.')
        }),
      })
      renderWith(phone)

      fireEvent.click(
        screen.getByRole('button', { name: 'Ligar para o contato' }),
      )

      await waitFor(() =>
        expect(notify.error).toHaveBeenCalledWith(
          'Permita o microfone no navegador para ligar.',
        ),
      )
    })
  })

  it('sets the reply target from the message context menu', async () => {
    setup()
    renderWithQuery(
      <WhatsappConversationView
        workspaceId='ws_1'
        conversation={conversation()}
      />,
    )
    const bubble = await screen.findByText('Preciso de ajuda com meu pedido')
    fireEvent.contextMenu(bubble)
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Responder' }))

    await waitFor(() =>
      expect(screen.getByTestId('composer').dataset.reply).toBe('m1'),
    )
  })
})

describe('<WhatsappConversationView /> · Equipes', () => {
  function team(
    id: string,
    name: string,
    roles: [string, 'LEADER' | 'AGENT'][],
  ) {
    return {
      id,
      workspaceId: 'ws_1',
      name,
      description: null,
      members: roles.map(([userId, role]) => ({
        userId,
        name: userId,
        email: `${userId}@x.com`,
        image: null,
        role,
      })),
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
  }

  const TEAMS = [
    team('tm_sales', 'Vendas', [
      ['u_1', 'LEADER'],
      ['u_2', 'AGENT'],
    ]),
    team('tm_support', 'Suporte', [['u_3', 'AGENT']]),
  ]
  const MEMBERS = [
    ...members,
    { id: 'u_3', name: 'Caio', email: 'caio@x.com', image: null },
  ]

  function event(
    id: string,
    kind: 'ASSIGNED' | 'TEAM_CHANGED',
    reason: string | null,
    actorName: string | null,
  ) {
    return {
      id,
      conversationId: 'cv_1',
      kind,
      source: 'AGENT',
      actorUserId: actorName ? 'u_2' : null,
      actorName,
      reason,
      createdAt: `2026-01-01T12:0${id.slice(-1)}:00.000Z`,
    }
  }

  function setupScope(
    scope: {
      mode: 'ALL' | 'SCOPED'
      leadsTeamIds: string[]
      memberTeamIds: string[]
    },
    extra: FetchRoute[] = [],
    teams = TEAMS,
  ) {
    return mockFetch([
      ...extra,
      { match: `${API}/teams/me`, data: scope },
      { match: `${API}/teams`, data: teams },
      { match: MESSAGES, data: [] },
      { match: `${API}/assignable-members`, data: MEMBERS },
      { match: '/api/users/me', data: { id: 'u_1', name: 'Eu Mesmo' } },
      {
        match: `${API}/conversations/cv_1/events`,
        data: [
          event('ev1', 'ASSIGNED', 'Eu Mesmo', 'Beatriz'),
          event('ev2', 'ASSIGNED', null, null),
          event('ev3', 'TEAM_CHANGED', 'Vendas', 'Beatriz'),
          event('ev4', 'TEAM_CHANGED', null, null),
        ],
      },
    ])
  }

  async function openTransfer() {
    fireEvent.click(screen.getByRole('button', { name: 'Transferir conversa' }))
    return screen.findByRole('menu')
  }

  it('shows the team badge and the assignment/team events', async () => {
    setupScope({ mode: 'ALL', leadsTeamIds: [], memberTeamIds: [] })
    renderWithQuery(
      <WhatsappConversationView
        workspaceId='ws_1'
        conversation={conversation({
          teamId: 'tm_sales',
          team: { id: 'tm_sales', name: 'Vendas' },
        })}
      />,
    )
    expect(screen.getByTitle('Equipe Vendas')).toBeTruthy()
    expect(
      await screen.findByText(/Conversa atribuída a Eu Mesmo por Beatriz/),
    ).toBeTruthy()
    expect(screen.getByText(/Conversa devolvida para a fila/)).toBeTruthy()
    expect(
      screen.getByText(/Conversa movida para a equipe Vendas por Beatriz/),
    ).toBeTruthy()
    expect(screen.getByText(/Conversa tirada da equipe/)).toBeTruthy()
    expect(screen.queryByText(/Motivo:/)).toBeNull()
  })

  it('lets a scoped agent only take a queue item', async () => {
    setupScope({ mode: 'SCOPED', leadsTeamIds: [], memberTeamIds: [] }, [], [])
    renderWithQuery(
      <WhatsappConversationView
        workspaceId='ws_1'
        conversation={conversation({ assignedUserId: null })}
      />,
    )
    await screen.findByText(/Conversa tirada da equipe/)
    const menu = await openTransfer()
    await within(menu).findByRole('menuitem', { name: 'Eu Mesmo (você)' })
    await waitFor(() =>
      expect(
        within(menu).queryByRole('menuitem', { name: 'Beatriz' }),
      ).toBeNull(),
    )
    expect(
      within(menu).queryByRole('menuitem', { name: 'Devolver para a fila' }),
    ).toBeNull()
    // Agents do not move conversations between teams.
    expect(
      screen.queryByRole('button', { name: 'Mover para outra equipe' }),
    ).toBeNull()
  })

  it('hands an own conversation back to the queue', async () => {
    const onSelectConversation = vi.fn()
    const fetchSpy = setupScope(
      { mode: 'SCOPED', leadsTeamIds: [], memberTeamIds: [] },
      [
        {
          method: 'PATCH',
          match: `${API}/conversations/cv_1/assign`,
          data: conversation({ assignedUserId: null }),
        },
      ],
      [],
    )
    renderWithQuery(
      <WhatsappConversationView
        workspaceId='ws_1'
        conversation={conversation({ assignedUserId: 'u_1' })}
        onSelectConversation={onSelectConversation}
      />,
    )
    await screen.findByText(/Conversa tirada da equipe/)
    const menu = await openTransfer()
    fireEvent.click(
      await within(menu).findByRole('menuitem', {
        name: 'Devolver para a fila',
      }),
    )
    await waitFor(() =>
      expect(
        fetchBody(fetchSpy, `${API}/conversations/cv_1/assign`, 'PATCH'),
      ).toEqual({ assignedUserId: null }),
    )
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Conversa devolvida à fila'),
    )
    expect(onSelectConversation).toHaveBeenCalled()
  })

  it('reports a refused assignment', async () => {
    setupScope({ mode: 'ALL', leadsTeamIds: [], memberTeamIds: [] }, [
      {
        method: 'PATCH',
        match: `${API}/conversations/cv_1/assign`,
        status: 403,
        error: 'Você não pode transferir esta conversa',
      },
    ])
    renderWithQuery(
      <WhatsappConversationView
        workspaceId='ws_1'
        conversation={conversation()}
      />,
    )
    await screen.findByText(/Conversa tirada da equipe/)
    const menu = await openTransfer()
    fireEvent.click(await within(menu).findByRole('menuitem', { name: 'Caio' }))
    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith(
        expect.anything(),
        'Não foi possível transferir a conversa',
      ),
    )
  })

  it('lets a leader assign inside the team and take it out of the team', async () => {
    const fetchSpy = setupScope(
      {
        mode: 'SCOPED',
        leadsTeamIds: ['tm_sales'],
        memberTeamIds: ['tm_sales'],
      },
      [
        {
          method: 'PATCH',
          match: `${API}/conversations/cv_1/team`,
          data: conversation({ assignedUserId: null, teamId: null }),
        },
      ],
    )
    renderWithQuery(
      <WhatsappConversationView
        workspaceId='ws_1'
        conversation={conversation({
          assignedUserId: null,
          teamId: 'tm_sales',
          team: { id: 'tm_sales', name: 'Vendas' },
        })}
      />,
    )
    await screen.findByText(/Conversa tirada da equipe/)

    const menu = await openTransfer()
    await within(menu).findByRole('menuitem', { name: 'Beatriz' })
    expect(within(menu).queryByRole('menuitem', { name: 'Caio' })).toBeNull()
    fireEvent.keyDown(menu, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())

    fireEvent.click(
      await screen.findByRole('button', { name: 'Mover para outra equipe' }),
    )
    const teamMenu = await screen.findByRole('menu')
    expect(
      within(teamMenu)
        .getByRole('menuitem', { name: 'Vendas (atual)' })
        .getAttribute('aria-disabled'),
    ).toBe('true')
    expect(
      within(teamMenu).queryByRole('menuitem', { name: 'Suporte' }),
    ).toBeNull()
    fireEvent.click(
      within(teamMenu).getByRole('menuitem', { name: 'Tirar da equipe' }),
    )
    await waitFor(() =>
      expect(
        fetchBody(fetchSpy, `${API}/conversations/cv_1/team`, 'PATCH'),
      ).toEqual({ teamId: null }),
    )
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Conversa sem equipe'),
    )
  })

  it('lets the owner move a conversation to any team and reports failures', async () => {
    const fetchSpy = setupScope(
      { mode: 'ALL', leadsTeamIds: [], memberTeamIds: [] },
      [
        {
          method: 'PATCH',
          match: `${API}/conversations/cv_1/team`,
          handler: (_url, init) =>
            JSON.parse(String(init?.body)).teamId === 'tm_support'
              ? conversation({ teamId: 'tm_support' })
              : new Response(
                  JSON.stringify({ success: false, statusCode: 403 }),
                  { status: 403 },
                ),
        },
      ],
    )
    renderWithQuery(
      <WhatsappConversationView
        workspaceId='ws_1'
        conversation={conversation()}
      />,
    )
    fireEvent.click(
      await screen.findByRole('button', { name: 'Mover para outra equipe' }),
    )
    const teamMenu = await screen.findByRole('menu')
    fireEvent.click(within(teamMenu).getByRole('menuitem', { name: 'Suporte' }))
    await waitFor(() =>
      expect(
        fetchBody(fetchSpy, `${API}/conversations/cv_1/team`, 'PATCH'),
      ).toEqual({ teamId: 'tm_support' }),
    )
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Conversa movida de equipe'),
    )
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())

    fireEvent.click(
      screen.getByRole('button', { name: 'Mover para outra equipe' }),
    )
    const again = await screen.findByRole('menu')
    fireEvent.click(within(again).getByRole('menuitem', { name: 'Vendas' }))
    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith(
        expect.anything(),
        'Não foi possível mover a conversa de equipe',
      ),
    )
  })

  describe('phone calls in the timeline', () => {
    function call(overrides: Record<string, unknown> = {}) {
      return {
        id: 'call1',
        conversationId: 'cv_1',
        direction: 'OUTBOUND',
        source: 'CLICK_TO_CALL',
        userId: 'u_1',
        extension: '200',
        destination: '11999998888',
        status: 'COMPLETED',
        answeredAt: null,
        endedAt: null,
        durationSeconds: 125,
        createdAt: '2026-01-01T12:30:00.000Z',
        recordingNotice: null,
        hasRecording: true,
        aiStatus: 'DONE',
        userName: 'Eu Mesmo',
        contactName: 'Maria',
        recording: {
          mimeType: 'audio/mpeg',
          sizeBytes: 100,
          expiresAt: '2026-04-01T12:00:00.000Z',
        },
        transcript: 'Bom dia, preciso da segunda via.',
        summary: 'Cliente pediu a segunda via do boleto.',
        sentiment: 'POSITIVE',
        sentimentScore: 0.6,
        nextSteps: ['Enviar a segunda via do boleto'],
        aiModel: 'openai:gpt-4o-mini',
        aiSkipReason: null,
        aiProcessedAt: null,
        sdTicketId: null,
        crmPersonId: 'p1',
        crmOpportunityId: null,
        voiceAgent: false,
        voiceEndReason: null,
        voiceTransferTarget: null,
        voiceHandoff: null,
        ...overrides,
      }
    }

    it('shows the finished call with audio, summary and next steps', async () => {
      const fetchSpy = setup([
        {
          match: `${API}/conversations/cv_1/calls`,
          data: [
            call(),
            call({ id: 'live', status: 'IN_PROGRESS', summary: 'ao vivo' }),
          ],
        },
        { method: 'POST', match: '/crm/tasks', data: { id: 't1' } },
      ])
      const { container } = renderWithQuery(
        <WhatsappConversationView
          workspaceId='ws_1'
          conversation={conversation()}
        />,
      )

      expect(
        await screen.findByText('Cliente pediu a segunda via do boleto.'),
      ).toBeTruthy()
      expect(screen.queryByText('ao vivo')).toBeNull()
      expect(screen.getByText('Cliente satisfeito')).toBeTruthy()
      expect(screen.getByText(/02:05/)).toBeTruthy()
      expect(container.querySelector('audio')?.getAttribute('src')).toBe(
        '/api/workspaces/ws_1/phone-calls/call1/recording',
      )

      fireEvent.click(screen.getByRole('button', { name: /Criar tarefa/ }))
      await waitFor(() =>
        expect(notify.success).toHaveBeenCalledWith('Tarefa criada'),
      )
      expect(fetchBody(fetchSpy, '/crm/tasks')).toMatchObject({
        title: 'Enviar a segunda via do boleto',
        personId: 'p1',
      })
    })

    it('explains why a call was not transcribed and hides the task button without a record', async () => {
      setup([
        {
          match: `${API}/conversations/cv_1/calls`,
          data: [
            call({
              aiStatus: 'SKIPPED',
              aiSkipReason: 'ai_quota_exceeded',
              summary: null,
              transcript: null,
              nextSteps: [],
              recording: null,
              hasRecording: false,
              crmPersonId: null,
            }),
          ],
        },
      ])
      renderWithQuery(
        <WhatsappConversationView
          workspaceId='ws_1'
          conversation={conversation()}
        />,
      )

      expect(
        await screen.findByText('A cota de IA do mês acabou.'),
      ).toBeTruthy()
      expect(screen.queryByRole('button', { name: /Criar tarefa/ })).toBeNull()
    })
  })

  describe('Pix', () => {
    const PIX_SETTINGS = `${API}/pix/settings`
    const PIX = `${API}/conversations/cv_1/pix`
    const pixSettings = (enabled: boolean) => ({
      workspaceId: 'ws_1',
      enabled,
      defaultExpiresMinutes: 60,
      provider: 'mock',
      isTestProvider: true,
    })
    const pixCharge = {
      id: 'ch_1',
      conversationId: 'cv_1',
      opportunityId: null,
      createdById: 'u_1',
      createdByAi: false,
      provider: 'mock',
      amount: 150,
      description: 'Mensalidade',
      brCode: '00020126mock6304ABCD',
      status: 'PAID',
      expiresAt: '2026-01-01T13:00:00.000Z',
      paidAt: '2026-01-01T12:30:00.000Z',
      paidAmount: 150,
      payerName: 'Maria',
      canceledAt: null,
      createdAt: '2026-01-01T12:10:00.000Z',
    }

    it('has no Pix button while the workspace keeps Pix off', async () => {
      setup([{ match: PIX_SETTINGS, data: pixSettings(false) }])
      renderWithQuery(
        <WhatsappConversationView
          workspaceId='ws_1'
          conversation={conversation()}
          onSelectConversation={vi.fn()}
        />,
      )
      await screen.findByText('Preciso de ajuda com meu pedido')
      expect(
        screen.queryByRole('button', { name: 'Cobrar via Pix' }),
      ).toBeNull()
    })

    it('opens the charge dialog from the header and lists the charges in the thread', async () => {
      setup([
        { match: PIX_SETTINGS, data: pixSettings(true) },
        { match: PIX, data: [pixCharge] },
        {
          match: `${API.replace('/whatsapp', '')}/crm/opportunities`,
          data: [],
        },
      ])
      renderWithQuery(
        <WhatsappConversationView
          workspaceId='ws_1'
          conversation={conversation()}
          onSelectConversation={vi.fn()}
        />,
      )

      expect(await screen.findByText(/Cobrança Pix · R\$\s150,00/)).toBeTruthy()
      expect(screen.getByText('Pago')).toBeTruthy()

      fireEvent.click(
        await screen.findByRole('button', { name: 'Cobrar via Pix' }),
      )
      expect(await screen.findByLabelText('Valor (R$)')).toBeTruthy()
    })

    it('blocks charging while the AI handles the conversation', async () => {
      setup([
        { match: PIX_SETTINGS, data: pixSettings(true) },
        { match: PIX, data: [] },
      ])
      renderWithQuery(
        <WhatsappConversationView
          workspaceId='ws_1'
          conversation={conversation({ aiActive: true })}
          onSelectConversation={vi.fn()}
        />,
      )
      const button = await screen.findByRole('button', {
        name: 'Cobrar via Pix',
      })
      expect((button as HTMLButtonElement).disabled).toBe(true)
    })
  })
})
