import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WorkspacePermissionsProvider } from '@/app/_components/workspace/workspace-permissions'
import {
  type FetchRoute,
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import type { WhatsAppSettingsDTO } from '@/types/whatsapp-settings'
import { WhatsappSettingsService } from '../whatsapp-settings-service'

vi.setConfig({ testTimeout: 20_000 })

const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/notify', () => ({ notify }))

const SETTINGS = '/api/workspaces/ws_1/whatsapp/settings'

function settings(
  overrides: Partial<WhatsAppSettingsDTO> = {},
): WhatsAppSettingsDTO {
  return {
    workspaceId: 'ws_1',
    autoCloseAfterHours: 24,
    sentimentAlertEnabled: true,
    sentimentAlertThreshold: -0.3,
    sentimentAlertNotifyInApp: true,
    sentimentAlertNotifyEmail: false,
    sentimentAlertRecipientIds: [],
    sentimentAlertAssignToId: null,
    sentimentAlertCooldownHours: 6,
    callRecordingEnabled: false,
    callRecordingNotice: 'Avise o contato.',
    callRecordingRetentionDays: 90,
    callTranscriptionEnabled: true,
    closeStatusMinSelections: 0,
    closeStatusMaxSelections: 1,
    businessHoursEnabled: false,
    businessHoursStart: '08:00',
    businessHoursEnd: '18:00',
    businessHoursDays: [1, 2, 3, 4, 5],
    unassignedAlertNotifyInApp: true,
    unassignedAlertNotifyEmail: false,
    unassignedReminderMinutes: 10,
    distributionMode: 'OFF',
    distributionMaxOpenPerAgent: null,
    distributionOnlyAvailable: true,
    distributionRespectBusinessHours: true,
    whatsappCheckTtlDays: 30,
    marketingLiteEnabled: false,
    marketingLiteCloudFallback: true,
    copilotSummaryOnTransfer: false,
    ...overrides,
  }
}

function setup(saved: WhatsAppSettingsDTO, extra: FetchRoute[] = []) {
  return mockFetch([
    ...extra,
    { method: 'PATCH', match: SETTINGS, data: saved },
    { match: SETTINGS, data: saved },
    {
      match: '/api/workspaces/ws_1/whatsapp/assignable-members',
      data: [
        { id: 'u_1', name: 'Ana Supervisora', email: 'ana@x.com', image: null },
        { id: 'u_2', name: 'Bruno', email: 'bruno@x.com', image: null },
      ],
    },
  ])
}

async function hoursInput(expected: string) {
  const input = (await screen.findByLabelText(
    'Fechar após quantas horas sem mensagens',
  )) as HTMLInputElement
  await waitFor(() => expect(input.value).toBe(expected))
  return input
}

function submit(input: HTMLElement) {
  // Submete direto: o clique pode ser barrado pela validação nativa.
  const form = input.closest('form')
  if (form) fireEvent.submit(form)
}

describe('<WhatsappSettingsService />', () => {
  it('hydrates the auto-close window and saves a new value', async () => {
    const fetchSpy = setup(settings({ autoCloseAfterHours: 12 }))
    renderWithQuery(<WhatsappSettingsService workspaceId='ws_1' />)

    const input = await hoursInput('12')
    fireEvent.change(input, { target: { value: '0' } })
    submit(input)

    await waitFor(() =>
      expect(fetchBody(fetchSpy, SETTINGS, 'PATCH')).toEqual(
        expect.objectContaining({ autoCloseAfterHours: 0 }),
      ),
    )
    await waitFor(() => expect(notify.success).toHaveBeenCalled())
  })

  it('rejects an invalid value without calling the API', async () => {
    const fetchSpy = setup(settings())
    renderWithQuery(<WhatsappSettingsService workspaceId='ws_1' />)

    const input = await hoursInput('24')
    fireEvent.change(input, { target: { value: '1.5' } })
    submit(input)

    await waitFor(() => expect(notify.error).toHaveBeenCalled())
    expect(fetchBody(fetchSpy, SETTINGS, 'PATCH')).toBeUndefined()
  })

  it('saves the sentiment alert recipients and e-mail channel', async () => {
    const fetchSpy = setup(settings())
    renderWithQuery(<WhatsappSettingsService workspaceId='ws_1' />)
    const input = await hoursInput('24')

    fireEvent.click(await screen.findByRole('checkbox', { name: 'E-mail' }))
    fireEvent.click(
      await screen.findByRole('checkbox', { name: /Ana Supervisora/ }),
    )
    submit(input)

    await waitFor(() =>
      expect(fetchBody(fetchSpy, SETTINGS, 'PATCH')).toEqual(
        expect.objectContaining({
          sentimentAlertEnabled: true,
          sentimentAlertNotifyEmail: true,
          sentimentAlertRecipientIds: ['u_1'],
          sentimentAlertAssignToId: null,
          sentimentAlertCooldownHours: 6,
        }),
      ),
    )
  })

  it('hides the alert options when the rule is turned off', async () => {
    setup(settings())
    renderWithQuery(<WhatsappSettingsService workspaceId='ws_1' />)
    await hoursInput('24')
    expect(screen.getByText('Quem avisar')).toBeTruthy()

    fireEvent.click(
      screen.getByRole('switch', { name: 'Alerta de sentimento negativo' }),
    )
    expect(screen.queryByText('Quem avisar')).toBeNull()
  })

  it('tells non-admins the settings are restricted', () => {
    mockFetch([])
    renderWithQuery(
      <WorkspacePermissionsProvider
        value={{ isPrivileged: false, permissions: null }}
      >
        <WhatsappSettingsService workspaceId='ws_1' />
      </WorkspacePermissionsProvider>,
    )

    expect(
      screen.getByText(/Somente proprietários e administradores/),
    ).toBeTruthy()
  })
})
