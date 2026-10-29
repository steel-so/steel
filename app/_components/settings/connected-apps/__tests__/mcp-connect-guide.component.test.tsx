import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { mockFetch, renderWithQuery } from '@/src/__tests__/component-utils'
import type { IntegrationGrantDTO } from '@/types/integration-grant'
import { McpConnectGuide } from '../mcp-connect-guide'

const notify = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }))
vi.mock('@/lib/notify', () => ({ notify }))

const URL = 'https://steel.example.com/api/mcp'

function grant(redirectHost: string, workspaceId = 'ws_1') {
  return {
    id: 'g1',
    client: { clientId: 'c', name: 'Claude', icon: null, uri: null },
    workspace: { id: workspaceId, name: 'Acme', slug: 'acme' },
    redirectHost,
    scopes: ['mcp:read'],
    modules: ['CRM'],
    lastUsedAt: null,
    createdAt: '2026-10-01T13:00:00.000Z',
  } as IntegrationGrantDTO
}

function setup(grants: IntegrationGrantDTO[] = []) {
  mockFetch([{ match: '/api/users/me/integration-grants', data: grants }])
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  })
  renderWithQuery(<McpConnectGuide workspaceId='ws_1' mcpUrl={URL} />)
  return writeText
}

describe('McpConnectGuide', () => {
  it('shows the server address and a guide per app', () => {
    setup()
    expect(screen.getByTestId('mcp-url').textContent).toBe(URL)
    for (const name of ['Claude', 'ChatGPT', 'Gemini']) {
      expect(screen.getByRole('heading', { name })).toBeTruthy()
    }
    expect(
      screen
        .getByRole('link', { name: /conectores do Claude/ })
        .getAttribute('href'),
    ).toBe('https://claude.ai/settings/connectors')
  })

  it('copies the address', async () => {
    const writeText = setup()
    fireEvent.click(screen.getByRole('button', { name: /Copiar endereço/ }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(URL))
    expect(notify.success).toHaveBeenCalledWith('Endereço copiado')
  })

  it('copies the terminal command with the address filled in', async () => {
    const writeText = setup()
    fireEvent.click(
      screen.getByRole('button', { name: /Copiar comando \(Gemini CLI/ }),
    )
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        `gemini mcp add --transport http steel ${URL}`,
      ),
    )
  })

  it('reports a copy failure', async () => {
    const writeText = setup()
    writeText.mockRejectedValue(new Error('denied'))
    fireEvent.click(screen.getByRole('button', { name: /Copiar endereço/ }))
    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith('Não foi possível copiar'),
    )
  })

  it('marks an app as connected only for this workspace', async () => {
    setup([grant('claude.ai'), grant('chatgpt.com', 'other_ws')])
    await waitFor(() =>
      expect(screen.getAllByText('Conectado')).toHaveLength(1),
    )
  })
})
