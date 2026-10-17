import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { mockFetch, renderWithQuery } from '@/src/__tests__/component-utils'
import type {
  WorkspaceIntegrationGrantDTO,
  WorkspaceIntegrationGrantsDTO,
} from '@/types/integration-grant'
import { WorkspaceConnectedAppsPanel } from '../workspace-connected-apps-panel'

vi.mock('@/lib/notify', () => ({
  notify: { success: vi.fn(), error: vi.fn() },
}))

const WS = 'ws_1'
const CLAUDE = { clientId: 'claude', name: 'Claude', icon: null, uri: null }
const CURSOR = { clientId: 'cursor', name: 'Cursor', icon: null, uri: null }

function grant(
  overrides: Partial<WorkspaceIntegrationGrantDTO>,
): WorkspaceIntegrationGrantDTO {
  return {
    id: 'g1',
    user: { id: 'u1', name: 'Ana Souza', email: 'ana@acme.com', image: null },
    client: CLAUDE,
    scopes: ['mcp:read'],
    modules: ['CRM'],
    lastUsedAt: null,
    // 13:00 UTC = 10:00 in São Paulo.
    createdAt: '2026-10-01T13:00:00.000Z',
    usage: { last7Days: 0, last30Days: 0 },
    ...overrides,
  }
}

const DATA: WorkspaceIntegrationGrantsDTO = {
  grants: [
    grant({ id: 'g1', usage: { last7Days: 1, last30Days: 12 } }),
    grant({ id: 'g2', client: CURSOR, scopes: ['mcp:read', 'mcp:write'] }),
    grant({
      id: 'g3',
      user: { id: 'u2', name: 'Bruno', email: 'bruno@acme.com', image: null },
      modules: ['SERVICE_DESK', 'COMMUNICATION'],
      lastUsedAt: '2026-10-16T18:30:00.000Z',
    }),
  ],
  clients: [
    {
      client: CLAUDE,
      members: 2,
      canWrite: false,
      lastUsedAt: '2026-10-16T18:30:00.000Z',
      usage: { last7Days: 4, last30Days: 40 },
    },
    {
      client: CURSOR,
      members: 1,
      canWrite: true,
      lastUsedAt: null,
      usage: { last7Days: 0, last30Days: 0 },
    },
  ],
}

describe('<WorkspaceConnectedAppsPanel />', () => {
  it('shows apps with usage and members with their grants', async () => {
    mockFetch([{ match: '/integration-grants', data: DATA }])
    renderWithQuery(<WorkspaceConnectedAppsPanel workspaceId={WS} />)

    expect(await screen.findByText('2 membros conectados')).toBeTruthy()
    expect(
      screen.getByText('4 chamadas em 7 dias · 40 chamadas em 30 dias'),
    ).toBeTruthy()
    expect(
      screen.getByText('1 chamada em 7 dias · 12 chamadas em 30 dias'),
    ).toBeTruthy()
    expect(screen.getByText('ServiceDesk, Comunicação')).toBeTruthy()
    expect(screen.getAllByText(/Conectado em 01\/10\/2026 10:00/)).toHaveLength(
      3,
    )
    expect(screen.getAllByText(/Último uso em 16\/10\/2026 15:30/).length).toBe(
      2,
    )
    // Ana holds two apps → bulk button; Bruno holds one → none.
    expect(screen.getAllByText('Revogar todos')).toHaveLength(1)
    expect(screen.getByText('Ana Souza')).toBeTruthy()
    expect(screen.getByText('AS')).toBeTruthy()
  })

  it('revokes an app from every member after confirming', async () => {
    const fetchSpy = mockFetch([
      { method: 'DELETE', match: '/clients/claude', data: { revoked: 2 } },
      { match: '/integration-grants', data: DATA },
    ])
    renderWithQuery(<WorkspaceConnectedAppsPanel workspaceId={WS} />)

    fireEvent.click((await screen.findAllByText('Revogar de todos'))[0])
    expect(await screen.findByText('Revogar Claude de todos?')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Revogar' }))

    await waitFor(() =>
      expect(
        fetchSpy.mock.calls.some(
          ([url, init]) =>
            String(url).endsWith(
              `/api/workspaces/${WS}/integration-grants/clients/claude`,
            ) && init?.method === 'DELETE',
        ),
      ).toBe(true),
    )
  })

  it('revokes all of a member and a single grant', async () => {
    const fetchSpy = mockFetch([
      { method: 'DELETE', match: '/members/u1', data: { revoked: 2 } },
      { method: 'DELETE', match: '/integration-grants/g3', data: { id: 'g3' } },
      { match: '/integration-grants', data: DATA },
    ])
    renderWithQuery(<WorkspaceConnectedAppsPanel workspaceId={WS} />)

    fireEvent.click(await screen.findByText('Revogar todos'))
    expect(
      await screen.findByText('Revogar todos os apps de Ana Souza?'),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Revogar' }))
    await waitFor(() =>
      expect(
        fetchSpy.mock.calls.some(([url]) =>
          String(url).includes('/members/u1'),
        ),
      ).toBe(true),
    )
    await waitFor(() =>
      expect(
        screen.queryByText('Revogar todos os apps de Ana Souza?'),
      ).toBeNull(),
    )

    const singles = screen.getAllByRole('button', { name: 'Revogar' })
    fireEvent.click(singles[singles.length - 1])
    expect(await screen.findByText('Revogar acesso?')).toBeTruthy()
    const confirm = screen
      .getAllByRole('button', { name: 'Revogar' })
      .find((button) => button.closest('[role="alertdialog"]'))
    fireEvent.click(confirm as HTMLElement)
    await waitFor(() =>
      expect(
        fetchSpy.mock.calls.some(([url]) =>
          String(url).endsWith('/integration-grants/g3'),
        ),
      ).toBe(true),
    )
  })

  it('shows the empty state and the error state', async () => {
    mockFetch([
      { match: '/integration-grants', data: { grants: [], clients: [] } },
    ])
    const { unmount } = renderWithQuery(
      <WorkspaceConnectedAppsPanel workspaceId={WS} />,
    )
    expect(await screen.findByText('Nenhum app conectado')).toBeTruthy()
    unmount()

    mockFetch([{ match: '/integration-grants', status: 500, error: 'boom' }])
    renderWithQuery(<WorkspaceConnectedAppsPanel workspaceId={WS} />)
    expect(await screen.findByRole('alert')).toBeTruthy()
  })
})
