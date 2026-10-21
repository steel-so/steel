import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import type { AdminWorkspaceDetailDTO } from '@/types/admin-workspace'
import { WorkspaceBlockedScreen } from '../../workspace/workspace-blocked-screen'
import { WorkspaceLifecyclePanel } from '../workspaces/workspace-lifecycle-panel'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh }),
  usePathname: () => '/admin/workspaces/ws_1',
}))

const notify = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}))
vi.mock('@/lib/notify', () => ({ notify }))

function workspace(
  overrides: Partial<AdminWorkspaceDetailDTO> = {},
): AdminWorkspaceDetailDTO {
  return {
    id: 'ws_1',
    name: 'Acme',
    slug: 'acme',
    activePlan: 'PRO',
    status: 'ACTIVE',
    memberCount: 4,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    trialEndsAt: null,
    suspendedAt: null,
    suspendedReason: null,
    allowedIps: [],
    ...overrides,
  }
}

describe('<WorkspaceLifecyclePanel />', () => {
  it('suspends with a reason and refreshes the page', async () => {
    const spy = mockFetch([
      {
        method: 'PATCH',
        match: '/api/admin/workspaces/ws_1/status',
        data: workspace({ status: 'SUSPENDED' }),
      },
    ])
    renderWithQuery(<WorkspaceLifecyclePanel workspace={workspace()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Suspender' }))
    fireEvent.change(await screen.findByLabelText('Motivo'), {
      target: { value: 'inadimplência de 60 dias' },
    })
    const dialogButtons = screen.getAllByRole('button', { name: 'Suspender' })
    fireEvent.click(dialogButtons[dialogButtons.length - 1])

    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Workspace suspenso'),
    )
    expect(fetchBody(spy, '/status', 'PATCH')).toEqual({
      action: 'suspend',
      reason: 'inadimplência de 60 dias',
    })
    expect(refresh).toHaveBeenCalled()
  })

  it('offers reactivation for a suspended workspace', () => {
    renderWithQuery(
      <WorkspaceLifecyclePanel
        workspace={workspace({ status: 'SUSPENDED' })}
      />,
    )
    expect(screen.getByRole('button', { name: 'Reativar' })).toBeTruthy()
  })

  it('disables every action while the workspace is being deleted', () => {
    renderWithQuery(
      <WorkspaceLifecyclePanel workspace={workspace({ status: 'DELETING' })} />,
    )
    const deleteButton = screen.getByRole('button', {
      name: 'Exclusão em andamento',
    }) as HTMLButtonElement
    expect(deleteButton.disabled).toBe(true)
    expect(
      (
        screen.getByRole('button', {
          name: 'Alterar plano',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
  })

  it('surfaces the API error when the deletion request is rejected', async () => {
    mockFetch([
      {
        method: 'POST',
        match: '/api/admin/workspaces/ws_1/deletion',
        status: 409,
        error: 'Já existe uma exclusão ou restauração em andamento',
      },
    ])
    renderWithQuery(<WorkspaceLifecyclePanel workspace={workspace()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    fireEvent.change(await screen.findByLabelText('Motivo'), {
      target: { value: 'encerramento do contrato' },
    })
    fireEvent.change(screen.getByLabelText(/para confirmar/), {
      target: { value: 'acme' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Excluir workspace' }))

    await waitFor(() => expect(notify.error).toHaveBeenCalled())
    expect(String(notify.error.mock.calls[0][0])).toContain('em andamento')
  })
})

describe('<WorkspaceBlockedScreen />', () => {
  it('explains the suspension and lists the other workspaces', () => {
    render(
      <WorkspaceBlockedScreen
        workspaceName='Acme'
        status='SUSPENDED'
        otherWorkspaces={[{ slug: 'beta', name: 'Beta' }]}
      />,
    )
    expect(screen.getByText('Acme está suspenso')).toBeTruthy()
    expect(
      screen.getByRole('link', { name: /Beta/ }).getAttribute('href'),
    ).toBe('/beta')
    expect(screen.getByText('Falar com o suporte')).toBeTruthy()
  })

  it('shows the deletion variant', () => {
    render(
      <WorkspaceBlockedScreen
        workspaceName='Acme'
        status='DELETING'
        otherWorkspaces={[]}
      />,
    )
    expect(screen.getByText('Acme está sendo excluído')).toBeTruthy()
    expect(screen.getByText('Criar outro workspace')).toBeTruthy()
  })
})
