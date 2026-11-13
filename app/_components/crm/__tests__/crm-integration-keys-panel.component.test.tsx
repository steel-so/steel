import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import { CrmIntegrationKeysPanel } from '../crm-integration-keys-panel'

const WS = 'ws_1'

const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/notify', () => ({ notify }))

const KEYS = [
  { id: 'k1', name: 'Zapier', prefix: 'stl_ab12', revokedAt: null },
  {
    id: 'k2',
    name: 'Antiga',
    prefix: 'stl_zz99',
    revokedAt: '2026-01-01T00:00:00.000Z',
  },
]

function setup(extra: Parameters<typeof mockFetch>[0] = []) {
  const spy = mockFetch([
    ...extra,
    {
      method: 'POST',
      match: /integration-keys$/,
      data: { id: 'k3', plaintextKey: 'stl_secret_value_123' },
    },
    { method: 'DELETE', match: '/integration-keys/', data: null },
    { match: '/crm/integration-keys', data: KEYS },
  ])
  renderWithQuery(<CrmIntegrationKeysPanel workspaceId={WS} />)
  return spy
}

describe('<CrmIntegrationKeysPanel />', () => {
  it('shows the empty state', async () => {
    setup([{ match: '/crm/integration-keys', data: [] }])
    expect(await screen.findByText('Nenhuma chave criada')).toBeTruthy()
  })

  it('lists keys with masked prefix and status; only active keys are revocable', async () => {
    setup()
    expect(await screen.findByText('Zapier')).toBeTruthy()
    expect(screen.getByText('stl_ab12…')).toBeTruthy()
    const active = screen.getByText('Zapier').closest('tr') as HTMLElement
    const revoked = screen.getByText('Antiga').closest('tr') as HTMLElement
    expect(active.textContent).toContain('Ativa')
    expect(revoked.textContent).toContain('Revogada')
    expect(active.querySelector('button')).toBeTruthy()
    expect(revoked.querySelector('button')).toBeNull()
  })

  it('revokes an active key', async () => {
    const spy = setup()
    const row = (await screen.findByText('Zapier')).closest('tr') as HTMLElement
    fireEvent.click(row.querySelector('button') as HTMLElement)
    expect(await screen.findByText('Revogar a chave "Zapier"?')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Revogar chave' }))
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Chave revogada'),
    )
    expect(
      spy.mock.calls.some(
        ([u, init]) =>
          init?.method === 'DELETE' &&
          String(u).endsWith('/integration-keys/k1'),
      ),
    ).toBe(true)
  })

  it('creates a key and reveals the plaintext only once', async () => {
    const spy = setup()
    fireEvent.click(screen.getByRole('button', { name: /nova chave/i }))
    const submit = (await screen.findByRole('button', {
      name: 'Criar chave',
    })) as HTMLButtonElement
    expect(submit.disabled).toBe(true)

    fireEvent.change(screen.getByPlaceholderText('Nome (ex.: Zapier)'), {
      target: { value: 'Make' },
    })
    fireEvent.click(submit)

    expect(await screen.findByText('stl_secret_value_123')).toBeTruthy()
    expect(
      screen.getByText(
        'Copie esta chave agora — ela não será mostrada novamente.',
      ),
    ).toBeTruthy()
    expect(fetchBody(spy, /integration-keys$/)).toMatchObject({
      name: 'Make',
    })

    fireEvent.click(screen.getByRole('button', { name: 'Concluir' }))
    await waitFor(() =>
      expect(screen.queryByText('stl_secret_value_123')).toBeNull(),
    )

    // Re-opening the dialog starts from a clean form, never the old secret.
    fireEvent.click(screen.getByRole('button', { name: /nova chave/i }))
    const input = (await screen.findByPlaceholderText(
      'Nome (ex.: Zapier)',
    )) as HTMLInputElement
    expect(input.value).toBe('')
    expect(screen.queryByText('stl_secret_value_123')).toBeNull()
  })

  it('notifies on creation failure and keeps the form', async () => {
    setup([
      {
        method: 'POST',
        match: /integration-keys$/,
        status: 403,
        error: 'Plano não permite chaves',
      },
    ])
    fireEvent.click(screen.getByRole('button', { name: /nova chave/i }))
    fireEvent.change(await screen.findByPlaceholderText('Nome (ex.: Zapier)'), {
      target: { value: 'Make' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Criar chave' }))
    await waitFor(() => expect(notify.error).toHaveBeenCalled())
    expect((notify.error.mock.lastCall?.[0] as Error)?.message).toBe(
      'Plano não permite chaves',
    )
    expect(screen.getByPlaceholderText('Nome (ex.: Zapier)')).toBeTruthy()
  })
})
