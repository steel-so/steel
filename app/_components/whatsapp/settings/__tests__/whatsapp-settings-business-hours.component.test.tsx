import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WorkspacePermissionsProvider } from '@/app/_components/workspace/workspace-permissions'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import { WhatsappSettingsBusinessHours } from '../whatsapp-settings-business-hours'

vi.setConfig({ testTimeout: 20_000 })

const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/notify', () => ({ notify }))

const SETTINGS = '/api/workspaces/ws_1/whatsapp/settings'

const saved = {
  workspaceId: 'ws_1',
  businessHoursEnabled: true,
  businessHoursStart: '08:00',
  businessHoursEnd: '18:00',
  businessHoursDays: [1, 2, 3, 4, 5],
  whatsappCheckTtlDays: 30,
  marketingLiteEnabled: false,
  marketingLiteCloudFallback: true,
}

function setup() {
  return mockFetch([
    { method: 'PATCH', match: SETTINGS, data: saved },
    { match: SETTINGS, data: saved },
  ])
}

describe('<WhatsappSettingsBusinessHours />', () => {
  it('hydrates the window and saves new hours and days', async () => {
    const fetchSpy = setup()
    renderWithQuery(<WhatsappSettingsBusinessHours workspaceId='ws_1' />)

    const start = (await screen.findByLabelText('Início')) as HTMLInputElement
    await waitFor(() => expect(start.value).toBe('08:00'))
    fireEvent.change(start, { target: { value: '09:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sáb' }))
    fireEvent.click(screen.getByRole('button', { name: 'Seg' }))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar horário' }))

    await waitFor(() =>
      expect(fetchBody(fetchSpy, SETTINGS, 'PATCH')).toEqual({
        businessHoursEnabled: true,
        businessHoursStart: '09:00',
        businessHoursEnd: '18:00',
        businessHoursDays: [2, 3, 4, 5, 6],
      }),
    )
    expect(notify.success).toHaveBeenCalledWith('Horário de atendimento salvo')
  })

  it('refuses the same start and end without saving', async () => {
    const fetchSpy = setup()
    renderWithQuery(<WhatsappSettingsBusinessHours workspaceId='ws_1' />)

    const end = (await screen.findByLabelText('Fim')) as HTMLInputElement
    await waitFor(() => expect(end.value).toBe('18:00'))
    fireEvent.change(end, { target: { value: '08:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar horário' }))

    expect(notify.error).toHaveBeenCalled()
    expect(fetchBody(fetchSpy, SETTINGS, 'PATCH')).toBeUndefined()
  })

  it('renders nothing for a non-admin', () => {
    setup()
    const { container } = renderWithQuery(
      <WorkspacePermissionsProvider
        value={{ isPrivileged: false, permissions: null }}
      >
        <WhatsappSettingsBusinessHours workspaceId='ws_1' />
      </WorkspacePermissionsProvider>,
    )
    expect(container.textContent).toBe('')
  })
})
