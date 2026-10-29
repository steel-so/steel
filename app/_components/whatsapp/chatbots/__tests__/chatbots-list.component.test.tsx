import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WorkspacePermissionsProvider } from '@/app/_components/workspace/workspace-permissions'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import { ChatbotsList } from '../chatbots-list'

vi.setConfig({ testTimeout: 20_000 })

const push = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}))
const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/notify', () => ({ notify }))

const BASE = '/api/workspaces/ws_1/whatsapp/chatbots'

const stats = {
  sessions: 12,
  running: 1,
  completed: 5,
  handedOffHuman: 4,
  handedOffAi: 2,
  expired: 0,
  cancelled: 0,
  failed: 0,
}

const bot = {
  id: 'bot_1',
  workspaceId: 'ws_1',
  connectionId: null,
  name: 'Atendimento inicial',
  description: 'Menu de boas-vindas',
  status: 'ACTIVE',
  triggerKind: 'NEW_CONVERSATION',
  keywords: [],
  sessionTtlMinutes: 720,
  publishedVersion: 2,
  publishedAt: '2026-10-01T12:00:00.000Z',
  hasUnpublishedChanges: true,
  createdAt: '2026-10-01T12:00:00.000Z',
  updatedAt: '2026-10-01T12:00:00.000Z',
  nodeCount: 6,
  stats,
}

const routes = [
  { match: BASE, data: [bot] },
  { match: '/whatsapp/connections', data: [] },
]

describe('<ChatbotsList />', () => {
  it('shows the bot with status, trigger and the 30-day numbers', async () => {
    mockFetch(routes)
    renderWithQuery(<ChatbotsList workspaceId='ws_1' slug='demo' />)

    expect(await screen.findByText('Atendimento inicial')).toBeTruthy()
    expect(screen.getByText('Ativo')).toBeTruthy()
    expect(screen.getByText(/Nova conversa · 6 blocos/)).toBeTruthy()
    expect(screen.getByText('12')).toBeTruthy()
    expect(screen.getByText('Alterações não publicadas')).toBeTruthy()
  })

  it('shows the empty state', async () => {
    mockFetch([{ match: BASE, data: [] }])
    renderWithQuery(<ChatbotsList workspaceId='ws_1' slug='demo' />)
    expect(await screen.findByText(/Nenhum chatbot criado ainda/)).toBeTruthy()
  })

  it('pauses an active bot', async () => {
    const spy = mockFetch([
      ...routes,
      { method: 'PUT', match: `${BASE}/bot_1/status`, data: bot },
    ])
    renderWithQuery(<ChatbotsList workspaceId='ws_1' slug='demo' />)

    fireEvent.click(await screen.findByRole('button', { name: 'Pausar' }))
    await waitFor(() =>
      expect(fetchBody(spy, '/status', 'PUT')).toEqual({ status: 'PAUSED' }),
    )
  })

  it('validates the name before creating', async () => {
    const spy = mockFetch(routes)
    renderWithQuery(<ChatbotsList workspaceId='ws_1' slug='demo' />)

    fireEvent.click(await screen.findByRole('button', { name: 'Novo chatbot' }))
    fireEvent.click(
      await screen.findByRole('button', { name: 'Criar chatbot' }),
    )

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Dê um nome ao chatbot',
    )
    expect(fetchBody(spy, BASE, 'POST')).toBeUndefined()
  })

  it('creates a bot and opens the editor', async () => {
    const spy = mockFetch([
      { method: 'POST', match: BASE, status: 201, data: bot },
      ...routes,
    ])
    renderWithQuery(<ChatbotsList workspaceId='ws_1' slug='demo' />)

    fireEvent.click(await screen.findByRole('button', { name: 'Novo chatbot' }))
    fireEvent.change(await screen.findByLabelText('Nome'), {
      target: { value: 'Suporte' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Criar chatbot' }))

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith('/demo/zap/chatbots/bot_1'),
    )
    expect(fetchBody(spy, BASE, 'POST')).toMatchObject({
      name: 'Suporte',
      template: 'menu',
      triggerKind: 'NEW_CONVERSATION',
    })
  })

  it('hides every mutating control from non-admins', async () => {
    mockFetch(routes)
    renderWithQuery(
      <WorkspacePermissionsProvider
        value={{ isPrivileged: false, permissions: null }}
      >
        <ChatbotsList workspaceId='ws_1' slug='demo' />
      </WorkspacePermissionsProvider>,
    )

    expect(await screen.findByText('Atendimento inicial')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Novo chatbot' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Pausar' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Excluir/ })).toBeNull()
    expect(screen.getByText('Ver fluxo')).toBeTruthy()
  })

  it('confirms before deleting', async () => {
    const spy = mockFetch([
      ...routes,
      { method: 'DELETE', match: `${BASE}/bot_1`, data: null },
    ])
    renderWithQuery(<ChatbotsList workspaceId='ws_1' slug='demo' />)

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Excluir Atendimento inicial',
      }),
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Excluir' }))
    await waitFor(() =>
      expect(spy.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(
        true,
      ),
    )
  })
})
