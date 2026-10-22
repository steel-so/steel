import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WorkspacePermissionsProvider } from '@/app/_components/workspace/workspace-permissions'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import { WhatsappSettingsDistribution } from '../whatsapp-settings-distribution'

vi.setConfig({ testTimeout: 20_000 })

const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/notify', () => ({ notify }))

const SETTINGS = '/api/workspaces/ws_1/whatsapp/settings'

const defaults = {
  workspaceId: 'ws_1',
  unassignedAlertNotifyInApp: true,
  unassignedAlertNotifyEmail: false,
  unassignedReminderMinutes: 10,
  distributionMode: 'OFF',
  distributionMaxOpenPerAgent: null,
  distributionOnlyAvailable: true,
  distributionRespectBusinessHours: true,
}

function setup(data: Record<string, unknown> = defaults) {
  return mockFetch([
    { method: 'PATCH', match: SETTINGS, data },
    { match: SETTINGS, data },
  ])
}

describe('<WhatsappSettingsDistribution />', () => {
  it('explains each mode in plain language and starts manual', async () => {
    setup()
    renderWithQuery(<WhatsappSettingsDistribution workspaceId='ws_1' />)

    expect(await screen.findByText('Manual')).toBeTruthy()
    expect(screen.getByText('Rodízio')).toBeTruthy()
    expect(screen.getByText('Menos ocupado')).toBeTruthy()
    expect(
      screen.getByText(/próximo atendente da vez, um após o outro/),
    ).toBeTruthy()
    // The detailed rules only show once a mode is chosen.
    expect(
      screen.queryByLabelText('Distribuir só para atendentes disponíveis'),
    ).toBeNull()
  })

  it('saves the reminder and the notice channels while the queue stays manual', async () => {
    const fetchSpy = setup()
    renderWithQuery(<WhatsappSettingsDistribution workspaceId='ws_1' />)

    const reminder = (await screen.findByLabelText(
      'Lembrar após quantos minutos sem atendente',
    )) as HTMLInputElement
    await waitFor(() => expect(reminder.value).toBe('10'))
    fireEvent.change(reminder, { target: { value: '25' } })
    fireEvent.click(
      screen.getByLabelText('Avisar por e-mail sobre conversas sem atendente'),
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Salvar fila e distribuição' }),
    )

    await waitFor(() =>
      expect(fetchBody(fetchSpy, SETTINGS, 'PATCH')).toEqual({
        unassignedAlertNotifyInApp: true,
        unassignedAlertNotifyEmail: true,
        unassignedReminderMinutes: 25,
        distributionMode: 'OFF',
        distributionMaxOpenPerAgent: null,
        distributionOnlyAvailable: true,
        distributionRespectBusinessHours: true,
      }),
    )
    expect(notify.success).toHaveBeenCalledWith('Fila e distribuição salvas')
  })

  it('turns on a mode with a cap and the options that go with it', async () => {
    const fetchSpy = setup()
    renderWithQuery(<WhatsappSettingsDistribution workspaceId='ws_1' />)

    // Wait for the saved settings to hydrate the form.
    const reminder = (await screen.findByLabelText(
      'Lembrar após quantos minutos sem atendente',
    )) as HTMLInputElement
    await waitFor(() => expect(reminder.value).toBe('10'))
    // Manual, Rodízio, Menos ocupado.
    fireEvent.click(screen.getAllByRole('radio')[2])
    fireEvent.click(
      await screen.findByLabelText('Limitar conversas abertas por atendente'),
    )
    const cap = (await screen.findByLabelText(
      'Máximo de conversas abertas',
    )) as HTMLInputElement
    fireEvent.change(cap, { target: { value: '7' } })
    fireEvent.click(
      screen.getByLabelText('Distribuir só para atendentes disponíveis'),
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Salvar fila e distribuição' }),
    )

    await waitFor(() =>
      expect(fetchBody(fetchSpy, SETTINGS, 'PATCH')).toMatchObject({
        distributionMode: 'LEAST_LOADED',
        distributionMaxOpenPerAgent: 7,
        distributionOnlyAvailable: false,
        distributionRespectBusinessHours: true,
      }),
    )
  })

  it('hydrates a saved configuration', async () => {
    setup({
      ...defaults,
      distributionMode: 'ROUND_ROBIN',
      distributionMaxOpenPerAgent: 4,
      distributionRespectBusinessHours: false,
      unassignedReminderMinutes: 0,
    })
    renderWithQuery(<WhatsappSettingsDistribution workspaceId='ws_1' />)

    const cap = (await screen.findByLabelText(
      'Máximo de conversas abertas',
    )) as HTMLInputElement
    expect(cap.value).toBe('4')
    expect(
      (
        screen.getByLabelText(
          'Lembrar após quantos minutos sem atendente',
        ) as HTMLInputElement
      ).value,
    ).toBe('0')
  })

  it('refuses an invalid reminder or cap without saving', async () => {
    const fetchSpy = setup({ ...defaults, distributionMode: 'ROUND_ROBIN' })
    renderWithQuery(<WhatsappSettingsDistribution workspaceId='ws_1' />)

    const reminder = (await screen.findByLabelText(
      'Lembrar após quantos minutos sem atendente',
    )) as HTMLInputElement
    await waitFor(() => expect(reminder.value).toBe('10'))
    fireEvent.change(reminder, { target: { value: '2000' } })
    // Submit the form directly: the browser's own min/max check would
    // otherwise stop the submit before our message.
    fireEvent.submit(reminder.closest('form') as HTMLFormElement)
    expect(notify.error).toHaveBeenCalledWith(
      'O lembrete deve ser de 0 a 1440 minutos',
    )

    fireEvent.change(reminder, { target: { value: '5' } })
    fireEvent.click(
      screen.getByLabelText('Limitar conversas abertas por atendente'),
    )
    fireEvent.change(
      await screen.findByLabelText('Máximo de conversas abertas'),
      {
        target: { value: '0' },
      },
    )
    // Submit the form directly: the browser's own min/max check would
    // otherwise stop the submit before our message.
    fireEvent.submit(reminder.closest('form') as HTMLFormElement)
    expect(notify.error).toHaveBeenCalledWith(
      'O limite deve ser de 1 a 500 conversas',
    )
    expect(fetchBody(fetchSpy, SETTINGS, 'PATCH')).toBeUndefined()
  })

  it('renders nothing for a non-admin', () => {
    setup()
    const { container } = renderWithQuery(
      <WorkspacePermissionsProvider
        value={{ isPrivileged: false, permissions: null }}
      >
        <WhatsappSettingsDistribution workspaceId='ws_1' />
      </WorkspacePermissionsProvider>,
    )
    expect(container.textContent).toBe('')
  })
})
