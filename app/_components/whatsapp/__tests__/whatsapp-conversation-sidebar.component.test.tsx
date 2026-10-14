import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  type FetchRoute,
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import type { WhatsAppConnectionDTO } from '@/types/whatsapp-connection'
import type { WhatsAppConversationDTO } from '@/types/whatsapp-conversation'
import { WhatsappConversationSidebar } from '../whatsapp-conversation-sidebar'

// Dialog/select flows render Base UI portals and wait on several fetches;
// the project default (5s) is too tight when the suite runs under load.
vi.setConfig({ testTimeout: 20_000 })

const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/notify', () => ({ notify }))

const API = '/api/workspaces/ws_1/whatsapp'

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
    contactAvatarUrl: null,
    status: 'IN_PROGRESS',
    assignedUserId: null,
    teamId: null,
    team: null,
    aiActive: false,
    aiHandoff: false,
    unreadCount: 0,
    avgSentimentScore: null,
    lastMessageAt: null,
    lastMessagePreview: 'Oi, tudo bem?',
    pinned: false,
    archived: false,
    closedAt: null,
    closeReason: null,
    contactSince: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function connection(id: string, label: string): WhatsAppConnectionDTO {
  return {
    id,
    workspaceId: 'ws_1',
    provider: 'ZAPI',
    label,
    phoneNumber: `55119${id}`,
    status: 'CONNECTED',
    statusError: null,
    zapiInstanceId: null,
    metaPhoneNumberId: null,
    metaWabaId: null,
    createdById: 'u_1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

const active = [
  conversation({ unreadCount: 3 }),
  conversation({
    id: 'cv_2',
    contactId: 'c2',
    contactName: null,
    contactWaId: '5521988887777',
    lastMessagePreview: null,
  }),
]
const archived = [
  conversation({ id: 'cv_9', contactName: 'Bruno Arquivado', archived: true }),
]
const closed = [
  conversation({ id: 'cv_8', contactName: 'Carla Fechada', status: 'CLOSED' }),
]

function setup(extra: FetchRoute[] = []) {
  return mockFetch([
    ...extra,
    { match: `${API}/conversations?archived=true`, data: archived },
    { match: `${API}/conversations?status=CLOSED`, data: closed },
    {
      match: /\/conversations\?status=OPEN(&connectionId=[^&]+)?$/,
      data: active,
    },
    {
      match: `${API}/contacts`,
      data: [
        {
          id: 'c1',
          workspaceId: 'ws_1',
          waId: '5511911111111',
          name: 'Ana Souza',
          avatarUrl: null,
          description: null,
          conversationCount: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    },
    { match: `${API}/connections`, data: [connection('conn_1', 'Suporte')] },
  ])
}

function renderSidebar(
  props: Partial<Parameters<typeof WhatsappConversationSidebar>[0]> = {},
) {
  const onSelect = vi.fn()
  const onConnectionChange = vi.fn()
  const utils = renderWithQuery(
    <WhatsappConversationSidebar
      workspaceId='ws_1'
      connections={[connection('conn_1', 'Suporte')]}
      connectionId={undefined}
      onConnectionChange={onConnectionChange}
      selectedConversationId={null}
      onSelect={onSelect}
      {...props}
    />,
  )
  return { ...utils, onSelect, onConnectionChange }
}

async function openActions(index = 0) {
  const trigger = (
    await screen.findAllByRole('button', { name: 'Ações da conversa' })
  )[index]
  fireEvent.click(trigger)
  return screen.findByRole('menu')
}

describe('<WhatsappConversationSidebar />', () => {
  it('lists conversations with unread badge and fallbacks', async () => {
    setup()
    renderSidebar()

    expect(await screen.findByText('Ana Souza')).toBeTruthy()
    expect(screen.getByText('Oi, tudo bem?')).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()
    // No name → WhatsApp id; no preview → placeholder.
    expect(screen.getByText('5521988887777')).toBeTruthy()
    expect(screen.getByText('Sem mensagens')).toBeTruthy()
  })

  it('filters by name or number as the user types', async () => {
    setup()
    renderSidebar()
    await screen.findByText('Ana Souza')

    const search = screen.getByPlaceholderText('Buscar conversa')
    fireEvent.change(search, { target: { value: 'ana' } })
    expect(screen.getByText('Ana Souza')).toBeTruthy()
    expect(screen.queryByText('5521988887777')).toBeNull()

    fireEvent.change(search, { target: { value: '552198' } })
    expect(screen.queryByText('Ana Souza')).toBeNull()
    expect(screen.getByText('5521988887777')).toBeTruthy()

    fireEvent.change(search, { target: { value: 'ninguém' } })
    expect(screen.getByText('Nenhuma conversa')).toBeTruthy()
  })

  it('shows the empty state when there are no conversations', async () => {
    mockFetch([{ match: `${API}/conversations`, data: [] }])
    renderSidebar()
    expect(await screen.findByText('Nenhuma conversa')).toBeTruthy()
  })

  it('selects a conversation on click', async () => {
    setup()
    const { onSelect } = renderSidebar()
    fireEvent.click(await screen.findByText('Ana Souza'))
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'cv_1' }),
    )
  })

  it('switches to archived conversations', async () => {
    const fetchSpy = setup()
    renderSidebar()
    await screen.findByText('Ana Souza')

    fireEvent.click(screen.getByRole('tab', { name: 'Arquivadas' }))
    expect(await screen.findByText('Bruno Arquivado')).toBeTruthy()
    expect(screen.queryByText('Ana Souza')).toBeNull()
    expect(
      fetchSpy.mock.calls.some(([url]) =>
        String(url).includes('archived=true'),
      ),
    ).toBe(true)
  })

  it('keeps closed conversations out of the active inbox, under "Fechadas"', async () => {
    const fetchSpy = setup()
    renderSidebar()
    await screen.findByText('Ana Souza')
    expect(screen.queryByText('Carla Fechada')).toBeNull()
    expect(
      fetchSpy.mock.calls.some(([url]) =>
        String(url).endsWith('/conversations?status=OPEN'),
      ),
    ).toBe(true)

    fireEvent.click(screen.getByRole('tab', { name: 'Fechadas' }))
    expect(await screen.findByText('Carla Fechada')).toBeTruthy()
    expect(screen.queryByText('Ana Souza')).toBeNull()
  })

  it('scopes the list to the selected connection', async () => {
    const fetchSpy = setup()
    renderSidebar({ connectionId: 'conn_1' })
    await screen.findByText('Ana Souza')
    expect(
      fetchSpy.mock.calls.some(([url]) =>
        String(url).endsWith('/conversations?status=OPEN&connectionId=conn_1'),
      ),
    ).toBe(true)
  })

  it('offers a connection filter only when there are multiple connections', async () => {
    setup()
    const { onConnectionChange, unmount } = renderSidebar()
    await screen.findByText('Ana Souza')
    expect(screen.queryByRole('combobox')).toBeNull()
    unmount()

    setup()
    const second = renderSidebar({
      connections: [connection('1', 'Suporte'), connection('2', 'Vendas')],
    })
    await screen.findByText('Ana Souza')
    fireEvent.click(screen.getByRole('combobox'))
    const option = within(await screen.findByRole('listbox')).getByRole(
      'option',
      { name: /Vendas/ },
    )
    fireEvent.pointerDown(option)
    fireEvent.click(option)
    expect(second.onConnectionChange).toHaveBeenCalledWith('2')
    expect(onConnectionChange).not.toHaveBeenCalled()
  })

  it('pins a conversation from the actions menu', async () => {
    const fetchSpy = setup([
      { method: 'PATCH', match: `${API}/conversations/cv_1/pin`, data: {} },
    ])
    renderSidebar()
    const menu = await openActions()
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Fixar/ }))

    await waitFor(() =>
      expect(
        fetchBody(fetchSpy, `${API}/conversations/cv_1/pin`, 'PATCH'),
      ).toEqual({ pinned: true }),
    )
  })

  it('confirms before deleting a conversation', async () => {
    const fetchSpy = setup([
      { method: 'DELETE', match: `${API}/conversations/cv_1`, data: null },
    ])
    renderSidebar()
    const menu = await openActions()
    fireEvent.click(
      within(menu).getByRole('menuitem', { name: /Excluir conversa/ }),
    )

    const alert = await screen.findByRole('alertdialog')
    expect(
      within(alert).getByText(/A conversa será removida da lista/),
    ).toBeTruthy()
    fireEvent.click(
      within(alert).getByRole('button', { name: 'Excluir conversa' }),
    )
    await waitFor(() =>
      expect(
        fetchSpy.mock.calls.some(
          ([url, init]) =>
            init?.method === 'DELETE' &&
            String(url).endsWith('/conversations/cv_1'),
        ),
      ).toBe(true),
    )
  })

  it('starts a new conversation with the chosen contact', async () => {
    const created = conversation({ id: 'cv_new' })
    const fetchSpy = setup([
      { method: 'POST', match: `${API}/conversations`, data: created },
    ])
    const { onSelect } = renderSidebar()
    await screen.findByText('Ana Souza')

    fireEvent.click(screen.getByRole('button', { name: 'Nova conversa' }))
    const dialog = await screen.findByRole('dialog')
    const submit = within(dialog).getByRole('button', {
      name: 'Iniciar conversa',
    }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)

    fireEvent.click(within(dialog).getByRole('combobox'))
    const option = within(await screen.findByRole('listbox')).getByRole(
      'option',
      { name: 'Ana Souza' },
    )
    fireEvent.pointerDown(option)
    fireEvent.click(option)

    await waitFor(() => expect(submit.disabled).toBe(false))
    fireEvent.click(submit)

    await waitFor(() =>
      expect(onSelect).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'cv_new' }),
      ),
    )
    // Single connection is picked automatically.
    expect(fetchBody(fetchSpy, `${API}/conversations`)).toEqual({
      contactId: 'c1',
      connectionId: 'conn_1',
    })
  })
})
