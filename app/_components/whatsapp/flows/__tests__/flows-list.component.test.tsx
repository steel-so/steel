import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WorkspacePermissionsProvider } from '@/app/_components/workspace/workspace-permissions'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import { FlowsList } from '../flows-list'

vi.setConfig({ testTimeout: 20_000 })

const push = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}))
const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/notify', () => ({ notify }))

const BASE = '/api/workspaces/ws_1/whatsapp/flows'

const flow = {
  id: 'flow_1',
  workspaceId: 'ws_1',
  connectionId: 'conn_1',
  name: 'Cadastro de clientes',
  description: 'Captura nome e e-mail',
  category: 'SIGN_UP',
  status: 'PUBLISHED',
  definition: {
    screens: [
      {
        title: 'Cadastro',
        fields: [{ key: 'nome', label: 'Nome', type: 'text', required: true }],
      },
    ],
  },
  bodyText: 'Preencha',
  ctaLabel: 'Cadastrar',
  confirmationText: null,
  crmAction: 'LEAD',
  sourceCrmFormId: null,
  metaFlowId: 'meta_1',
  metaStatus: 'PUBLISHED',
  publishError: null,
  publishedVersion: 2,
  publishedAt: '2026-10-01T12:00:00.000Z',
  hasUnpublishedChanges: true,
  sendable: true,
  createdAt: '2026-10-01T12:00:00.000Z',
  updatedAt: '2026-10-01T12:00:00.000Z',
  sent: 10,
  completed: 7,
}

const connections = [
  {
    id: 'conn_1',
    provider: 'META',
    label: 'Oficial',
    phoneNumber: '5511999990000',
  },
  {
    id: 'conn_2',
    provider: 'ZAPI',
    label: 'Z-API',
    phoneNumber: '5511999991111',
  },
]

const routes = [
  { match: BASE, data: [flow] },
  { match: '/whatsapp/connections', data: connections },
]

describe('<FlowsList />', () => {
  it('shows the flow with status, screens and the counters', async () => {
    mockFetch(routes)
    renderWithQuery(<FlowsList workspaceId='ws_1' slug='demo' />)

    expect(await screen.findByText('Cadastro de clientes')).toBeTruthy()
    expect(screen.getByText('Publicado')).toBeTruthy()
    expect(screen.getByText(/Cadastro · 1 tela/)).toBeTruthy()
    expect(screen.getByText('10')).toBeTruthy()
    expect(screen.getByText('7')).toBeTruthy()
    expect(
      screen.getByText('Alterações ainda não enviadas à Meta'),
    ).toBeTruthy()
  })

  it('shows the empty state', async () => {
    mockFetch([{ match: BASE, data: [] }])
    renderWithQuery(<FlowsList workspaceId='ws_1' slug='demo' />)
    expect(
      await screen.findByText(/Nenhum formulário criado ainda/),
    ).toBeTruthy()
  })

  it('shows an error when the list cannot be loaded', async () => {
    mockFetch([{ match: BASE, status: 500, data: null }])
    renderWithQuery(<FlowsList workspaceId='ws_1' slug='demo' />)
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Não foi possível carregar',
    )
  })

  it('validates the form before creating', async () => {
    const spy = mockFetch(routes)
    renderWithQuery(<FlowsList workspaceId='ws_1' slug='demo' />)

    fireEvent.click(
      await screen.findByRole('button', { name: 'Novo formulário' }),
    )
    fireEvent.click(
      await screen.findByRole('button', { name: 'Criar formulário' }),
    )
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Dê um nome ao formulário',
    )

    fireEvent.change(screen.getByLabelText('Nome'), {
      target: { value: 'Pesquisa' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Criar formulário' }))
    expect((await screen.findByRole('alert')).textContent).toContain(
      'conexão Meta',
    )
    expect(fetchBody(spy, BASE, 'POST')).toBeUndefined()
  })

  it('creates a flow on a Meta connection and opens the editor', async () => {
    const spy = mockFetch([
      { method: 'POST', match: BASE, status: 201, data: flow },
      ...routes,
    ])
    renderWithQuery(<FlowsList workspaceId='ws_1' slug='demo' />)

    fireEvent.click(
      await screen.findByRole('button', { name: 'Novo formulário' }),
    )
    fireEvent.change(await screen.findByLabelText('Nome'), {
      target: { value: 'Pesquisa' },
    })
    fireEvent.click(screen.getByRole('combobox', { name: 'Conexão' }))
    // Only the Meta connection is offered.
    expect(screen.queryByText(/Z-API/)).toBeNull()
    fireEvent.click(await screen.findByRole('option', { name: /Oficial/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Criar formulário' }))

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith('/demo/zap/flows/flow_1'),
    )
    expect(fetchBody(spy, BASE, 'POST')).toMatchObject({
      name: 'Pesquisa',
      connectionId: 'conn_1',
      preset: 'SIGN_UP',
    })
  })

  it('hides every mutating control from non-admins', async () => {
    mockFetch(routes)
    renderWithQuery(
      <WorkspacePermissionsProvider
        value={{ isPrivileged: false, permissions: null }}
      >
        <FlowsList workspaceId='ws_1' slug='demo' />
      </WorkspacePermissionsProvider>,
    )
    expect(await screen.findByText('Cadastro de clientes')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Novo formulário' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Excluir/ })).toBeNull()
    expect(screen.getByText('Ver')).toBeTruthy()
  })

  it('retires a flow that already has answers instead of deleting it', async () => {
    const spy = mockFetch([
      ...routes,
      {
        method: 'POST',
        match: `${BASE}/flow_1/deprecate`,
        data: { ...flow, status: 'DEPRECATED' },
      },
    ])
    renderWithQuery(<FlowsList workspaceId='ws_1' slug='demo' />)

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Excluir Cadastro de clientes',
      }),
    )
    expect(await screen.findByText('Descontinuar formulário?')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Descontinuar' }))
    await waitFor(() =>
      expect(
        spy.mock.calls.some(([url]) => String(url).endsWith('/deprecate')),
      ).toBe(true),
    )
    expect(spy.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(
      false,
    )
  })

  it('deletes a flow that was never sent', async () => {
    const spy = mockFetch([
      { match: BASE, data: [{ ...flow, sent: 0, completed: 0 }] },
      { match: '/whatsapp/connections', data: connections },
      { method: 'DELETE', match: `${BASE}/flow_1`, data: null },
    ])
    renderWithQuery(<FlowsList workspaceId='ws_1' slug='demo' />)

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Excluir Cadastro de clientes',
      }),
    )
    expect(await screen.findByText('Excluir formulário?')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    await waitFor(() =>
      expect(spy.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(
        true,
      ),
    )
  })
})
