import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { mockFetch, renderWithQuery } from '@/src/__tests__/component-utils'
import type { ApiTokenDTO } from '@/types/api-token'
import { UserModalApiTokens } from '../user-modal-api-tokens'

vi.mock('@/lib/notify', () => ({
  notify: { success: vi.fn(), error: vi.fn() },
}))

const WORKSPACE = { id: 'ws_1', name: 'Acme', slug: 'acme' }

function token(overrides: Partial<ApiTokenDTO> = {}): ApiTokenDTO {
  return {
    id: 't1',
    name: 'GitHub Actions',
    prefix: 'stl_pat_Xk3v9QaB',
    workspace: WORKSPACE,
    scopes: ['api:read'],
    modules: ['SERVICE_DESK', 'CRM'],
    createdVia: 'SETTINGS',
    deviceName: null,
    // 13:00 UTC = 10:00 in São Paulo, same calendar day.
    expiresAt: '2027-01-15T13:00:00.000Z',
    expired: false,
    lastUsedAt: null,
    createdAt: '2026-10-17T13:00:00.000Z',
    ...overrides,
  }
}

describe('<UserModalApiTokens />', () => {
  it('lists tokens with prefix, access, modules and dates', async () => {
    mockFetch([
      {
        match: '/api/users/me/api-tokens',
        data: [
          token(),
          token({
            id: 't2',
            name: 'Steel CLI — notebook',
            scopes: ['api:read', 'api:write'],
            expired: true,
          }),
        ],
      },
    ])
    renderWithQuery(<UserModalApiTokens />)

    expect(await screen.findByText('GitHub Actions')).toBeTruthy()
    expect(screen.getAllByText('stl_pat_Xk3v9QaB…')).toHaveLength(2)
    expect(screen.getByText('Somente ler')).toBeTruthy()
    expect(screen.getByText('Ler e alterar')).toBeTruthy()
    expect(screen.getByText('Expirado')).toBeTruthy()
    expect(screen.getAllByText('Acme · ServiceDesk, CRM')).toHaveLength(2)
    expect(
      screen.getAllByText(/Criado em 17 de out\. de 2026/).length,
    ).toBeGreaterThan(0)
  })

  it('shows the empty state', async () => {
    mockFetch([{ match: '/api/users/me/api-tokens', data: [] }])
    renderWithQuery(<UserModalApiTokens />)
    expect(await screen.findByText('Nenhum token criado.')).toBeTruthy()
  })

  it('creates a token and shows its value once', async () => {
    const fetchSpy = mockFetch([
      {
        match: '/api/users/me/api-tokens/workspaces',
        data: [{ ...WORKSPACE, modules: ['SERVICE_DESK', 'CRM'] }],
      },
      {
        method: 'POST',
        match: '/api/users/me/api-tokens',
        status: 201,
        data: { ...token(), token: 'stl_pat_secret-value' },
      },
      { match: '/api/users/me/api-tokens', data: [] },
    ])
    renderWithQuery(<UserModalApiTokens />)

    fireEvent.click(await screen.findByRole('button', { name: 'Criar token' }))
    fireEvent.change(await screen.findByLabelText('Nome'), {
      target: { value: 'GitHub Actions' },
    })
    const submit = screen
      .getAllByRole('button', { name: 'Criar token' })
      .find((button) => button.getAttribute('type') === 'submit')
    if (!submit) throw new Error('submit button not found')
    fireEvent.click(submit)

    expect(await screen.findByText('stl_pat_secret-value')).toBeTruthy()
    expect(screen.getByText('Token criado')).toBeTruthy()

    const post = fetchSpy.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      name: 'GitHub Actions',
      workspaceId: 'ws_1',
      modules: ['SERVICE_DESK', 'CRM'],
      scopes: ['api:read'],
      expiresInDays: 90,
    })

    fireEvent.click(screen.getByRole('button', { name: 'Concluir' }))
    await waitFor(() =>
      expect(screen.queryByText('stl_pat_secret-value')).toBeNull(),
    )
  })

  it('revokes a token after confirming', async () => {
    const fetchSpy = mockFetch([
      { method: 'DELETE', match: '/api-tokens/t1', data: { id: 't1' } },
      { match: '/api/users/me/api-tokens', data: [token()] },
    ])
    renderWithQuery(<UserModalApiTokens />)

    fireEvent.click(await screen.findByRole('button', { name: 'Revogar' }))
    expect(await screen.findByText('Revogar token?')).toBeTruthy()
    const buttons = screen.getAllByRole('button', { name: 'Revogar' })
    fireEvent.click(buttons[buttons.length - 1])

    await waitFor(() =>
      expect(
        fetchSpy.mock.calls.some(
          ([url, init]) =>
            String(url).endsWith('/api/users/me/api-tokens/t1') &&
            init?.method === 'DELETE',
        ),
      ).toBe(true),
    )
  })
})
