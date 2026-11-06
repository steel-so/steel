import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import { WorkspaceWhatsappAgentReportSection } from '../workspaces/workspace-whatsapp-agent-report-section'

vi.setConfig({ testTimeout: 20_000 })

const notify = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}))
vi.mock('@/lib/notify', () => ({ notify }))

const BASE = '/api/admin/workspaces/ws_1/whatsapp-agent-report'

describe('<WorkspaceWhatsappAgentReportSection />', () => {
  it('is off by default and turns on', async () => {
    const fetchSpy = mockFetch([
      {
        method: 'PATCH',
        match: BASE,
        data: { enabled: true, updatedAt: null },
      },
      { match: BASE, data: { enabled: false, updatedAt: null } },
    ])
    renderWithQuery(<WorkspaceWhatsappAgentReportSection workspaceId='ws_1' />)

    const toggle = await screen.findByRole('switch', {
      name: 'Relatório de atendentes',
    })
    expect(toggle.getAttribute('aria-checked')).toBe('false')

    fireEvent.click(toggle)
    await waitFor(() =>
      expect(fetchBody(fetchSpy, BASE, 'PATCH')).toEqual({ enabled: true }),
    )
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith(
        'Relatório de atendentes ativado',
      ),
    )
  })

  it('locks the switch while the workspace is being deleted', async () => {
    mockFetch([{ match: BASE, data: { enabled: true, updatedAt: null } }])
    renderWithQuery(
      <WorkspaceWhatsappAgentReportSection workspaceId='ws_1' disabled />,
    )
    const toggle = await screen.findByRole('switch', {
      name: 'Relatório de atendentes',
    })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(
      (toggle as HTMLButtonElement).disabled ||
        toggle.getAttribute('data-disabled') !== null,
    ).toBe(true)
  })

  it('shows an error state when the settings cannot be loaded', async () => {
    mockFetch([{ match: BASE, status: 500, error: 'boom' }])
    renderWithQuery(<WorkspaceWhatsappAgentReportSection workspaceId='ws_1' />)
    expect(
      await screen.findByText(
        'Não foi possível carregar o relatório de atendentes.',
      ),
    ).toBeTruthy()
  })
})
