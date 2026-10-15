import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  createTestQueryClient,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import type { WhatsAppGroupDTO } from '@/types/whatsapp-group'
import { WhatsappGroupView } from '../whatsapp-group-view'

vi.setConfig({ testTimeout: 20_000 })

const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/notify', () => ({ notify }))
vi.mock('@/src/lib/auth-client', () => ({
  authClient: { useSession: () => ({ data: { user: { id: 'u_1' } } }) },
}))

const MESSAGES = '/api/workspaces/ws_1/whatsapp/groups/g_1/messages'

const group: WhatsAppGroupDTO = {
  id: 'g_1',
  workspaceId: 'ws_1',
  connectionId: 'conn_1',
  groupJid: '1203@g.us',
  name: 'Time comercial',
  imageUrl: null,
  description: null,
  inviteLink: null,
  archived: false,
  lastMessageAt: null,
  lastMessagePreview: null,
  participants: [{ waId: '5511911111111', name: 'Carlos', role: 'MEMBER' }],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

function setup() {
  return mockFetch([
    { method: 'POST', match: MESSAGES, data: {} },
    { match: MESSAGES, data: [] },
    {
      match: '/whatsapp/quick-replies',
      data: [
        {
          id: 'qr_1',
          shortcut: 'saudacao',
          title: 'Saudação',
          body: 'Bom dia, aqui é {nome_usuario}.',
          mediaUrl: null,
          buttons: [],
        },
      ],
    },
    { match: '/whatsapp/contacts', data: [] },
  ])
}

function renderView() {
  const client = createTestQueryClient()
  client.setQueryData([['user'], 'u_1'], { id: 'u_1', name: 'Joana' })
  return renderWithQuery(
    <WhatsappGroupView workspaceId='ws_1' group={group} />,
    {
      client,
    },
  )
}

const textarea = () =>
  screen.getByPlaceholderText(
    'Digite uma mensagem — use @ para mencionar',
  ) as HTMLTextAreaElement

const posted = (spy: ReturnType<typeof setup>) =>
  spy.mock.calls
    .filter(([url, init]) => String(url).endsWith(MESSAGES) && init?.method)
    .map(([, init]) => JSON.parse(String(init?.body)))

describe('<WhatsappGroupView /> slash quick replies', () => {
  it('expands `/shortcut` + Enter with the agent name, then sends on Enter', async () => {
    const spy = setup()
    renderView()

    fireEvent.change(textarea(), { target: { value: '/sauda' } })
    const list = await screen.findByRole('listbox', {
      name: 'Mensagens rápidas',
    })
    expect(within(list).getByText('/saudacao')).toBeTruthy()
    expect(textarea().getAttribute('aria-controls')).toBe(
      'whatsapp-quick-reply-list',
    )

    fireEvent.keyDown(textarea(), { key: 'Enter' })
    expect(textarea().value).toBe('Bom dia, aqui é Joana.')
    expect(posted(spy)).toEqual([])

    fireEvent.keyDown(textarea(), { key: 'Enter' })
    await waitFor(() =>
      expect(posted(spy)).toEqual([
        { text: 'Bom dia, aqui é Joana.', mentionedWaIds: [] },
      ]),
    )
  })

  it('sends the reply, not the command, from the send button', async () => {
    const spy = setup()
    renderView()

    fireEvent.change(textarea(), { target: { value: '/saudacao' } })
    await screen.findByRole('listbox')
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))

    await waitFor(() =>
      expect(posted(spy)).toEqual([
        { text: 'Bom dia, aqui é Joana.', mentionedWaIds: [] },
      ]),
    )
  })

  it('inserts a reply picked from the quick reply menu', async () => {
    setup()
    renderView()

    fireEvent.change(textarea(), { target: { value: 'Pessoal: ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Mensagem rápida' }))
    fireEvent.click(await screen.findByText('/saudacao'))
    expect(textarea().value).toBe('Pessoal: Bom dia, aqui é Joana.')
  })
})
