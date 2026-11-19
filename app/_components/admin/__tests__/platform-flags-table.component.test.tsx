import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import type { PlatformFlagDTO } from '@/types/platform-flag'
import { PlatformFlagsTable } from '../feature-flags/platform-flags-table'

vi.mock('@/lib/notify', () => ({
  notify: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

const FLAG: PlatformFlagDTO = {
  id: 'f1',
  key: 'novo-dashboard',
  name: 'Novo dashboard',
  description: 'Painel redesenhado',
  enabled: false,
  betaEnabled: true,
  workspaceCount: 2,
  createdAt: '2026-11-19T12:00:00.000Z',
  updatedAt: '2026-11-19T12:00:00.000Z',
}

describe('<PlatformFlagsTable />', () => {
  it('shows the empty state without flags', () => {
    renderWithQuery(
      <PlatformFlagsTable flags={[]} onEdit={vi.fn()} onGrants={vi.fn()} />,
    )
    expect(screen.getByText('Nenhuma feature flag ainda')).toBeTruthy()
  })

  it('renders each flag with its switches and counts', () => {
    renderWithQuery(
      <PlatformFlagsTable flags={[FLAG]} onEdit={vi.fn()} onGrants={vi.fn()} />,
    )
    expect(screen.getByText('novo-dashboard')).toBeTruthy()
    expect(
      screen
        .getByLabelText('Ligar Novo dashboard para todos')
        .getAttribute('aria-checked'),
    ).toBe('false')
    expect(
      screen
        .getByLabelText('Ligar Novo dashboard para beta')
        .getAttribute('aria-checked'),
    ).toBe('true')
    expect(screen.getByText('2 liberados')).toBeTruthy()
  })

  it('turns the flag on globally through the API', async () => {
    const spy = mockFetch([
      { method: 'PATCH', match: '/api/admin/feature-flags/f1', data: FLAG },
      { match: '/api/admin/feature-flags', data: [FLAG] },
    ])
    renderWithQuery(
      <PlatformFlagsTable flags={[FLAG]} onEdit={vi.fn()} onGrants={vi.fn()} />,
    )
    fireEvent.click(screen.getByLabelText('Ligar Novo dashboard para todos'))
    await waitFor(() =>
      expect(fetchBody(spy, '/api/admin/feature-flags/f1', 'PATCH')).toEqual({
        enabled: true,
      }),
    )
  })

  it('confirms before deleting', async () => {
    const spy = mockFetch([
      {
        method: 'DELETE',
        match: '/api/admin/feature-flags/f1',
        data: { id: 'f1' },
      },
      { match: '/api/admin/feature-flags', data: [] },
    ])
    renderWithQuery(
      <PlatformFlagsTable flags={[FLAG]} onEdit={vi.fn()} onGrants={vi.fn()} />,
    )
    fireEvent.click(screen.getByText('Excluir'))
    expect(await screen.findByText('Excluir flag')).toBeTruthy()
    fireEvent.click(screen.getAllByText('Excluir').at(-1) as HTMLElement)
    await waitFor(() =>
      expect(
        spy.mock.calls.some(
          ([url, init]) =>
            String(url).includes('/api/admin/feature-flags/f1') &&
            (init as RequestInit | undefined)?.method === 'DELETE',
        ),
      ).toBe(true),
    )
  })
})
