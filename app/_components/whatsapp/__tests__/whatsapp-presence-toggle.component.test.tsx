import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import { WhatsappPresenceToggle } from '../whatsapp-presence-toggle'

vi.setConfig({ testTimeout: 20_000 })

const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/notify', () => ({ notify }))

const ME = '/api/workspaces/ws_1/whatsapp/presence/me'

function presence(status: 'AVAILABLE' | 'AWAY') {
  return { userId: 'u1', status, updatedAt: null }
}

describe('<WhatsappPresenceToggle />', () => {
  it('shows Disponível and flips to Ausente', async () => {
    const fetchSpy = mockFetch([
      { method: 'PUT', match: ME, data: presence('AWAY') },
      { match: ME, data: presence('AVAILABLE') },
    ])
    renderWithQuery(<WhatsappPresenceToggle workspaceId='ws_1' />)

    expect(await screen.findByText('Disponível')).toBeTruthy()
    const toggle = screen.getByRole('switch', {
      name: 'Disponível para receber conversas',
    })
    await waitFor(() => expect(toggle.hasAttribute('disabled')).toBe(false))
    fireEvent.click(toggle)

    await waitFor(() =>
      expect(fetchBody(fetchSpy, ME, 'PUT')).toEqual({ status: 'AWAY' }),
    )
    expect(await screen.findByText('Ausente')).toBeTruthy()
    expect(screen.getByText('Você não recebe conversas novas.')).toBeTruthy()
  })

  it('shows Ausente and flips back to Disponível', async () => {
    const fetchSpy = mockFetch([
      { method: 'PUT', match: ME, data: presence('AVAILABLE') },
      { match: ME, data: presence('AWAY') },
    ])
    renderWithQuery(<WhatsappPresenceToggle workspaceId='ws_1' />)

    expect(await screen.findByText('Ausente')).toBeTruthy()
    const toggle = screen.getByRole('switch')
    await waitFor(() => expect(toggle.hasAttribute('disabled')).toBe(false))
    fireEvent.click(toggle)

    await waitFor(() =>
      expect(fetchBody(fetchSpy, ME, 'PUT')).toEqual({ status: 'AVAILABLE' }),
    )
    expect(
      await screen.findByText('Você recebe conversas da fila.'),
    ).toBeTruthy()
  })

  it('rolls back and warns when the server refuses', async () => {
    mockFetch([
      {
        method: 'PUT',
        match: ME,
        status: 403,
        error: 'Permissão insuficiente',
      },
      { match: ME, data: presence('AVAILABLE') },
    ])
    renderWithQuery(<WhatsappPresenceToggle workspaceId='ws_1' />)

    await screen.findByText('Disponível')
    const toggle = screen.getByRole('switch')
    await waitFor(() => expect(toggle.hasAttribute('disabled')).toBe(false))
    fireEvent.click(toggle)

    await waitFor(() => expect(notify.error).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByText('Disponível')).toBeTruthy())
  })
})
