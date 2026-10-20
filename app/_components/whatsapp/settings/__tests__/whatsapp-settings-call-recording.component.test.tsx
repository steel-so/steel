import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WorkspacePermissionsProvider } from '@/app/_components/workspace/workspace-permissions'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import type { WhatsAppSettingsDTO } from '@/types/whatsapp-settings'
import { WhatsappSettingsCallRecording } from '../whatsapp-settings-call-recording'

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
    callRecordingNotice: 'Avise o contato: ligação gravada.',
    callRecordingRetentionDays: 90,
    callTranscriptionEnabled: true,
    closeStatusMinSelections: 0,
    closeStatusMaxSelections: 1,
    businessHoursEnabled: false,
    businessHoursStart: '08:00',
    businessHoursEnd: '18:00',
    businessHoursDays: [1, 2, 3, 4, 5],
    ...overrides,
  }
}

function setup(saved: WhatsAppSettingsDTO) {
  return mockFetch([
    { method: 'PATCH', match: SETTINGS, data: saved },
    { match: SETTINGS, data: saved },
  ])
}

function submit(element: HTMLElement) {
  const form = element.closest('form')
  if (form) fireEvent.submit(form)
}

describe('<WhatsappSettingsCallRecording />', () => {
  it('turns recording on and saves the notice, retention and AI switch', async () => {
    const fetchSpy = setup(settings())
    renderWithQuery(<WhatsappSettingsCallRecording workspaceId='ws_1' />)

    const toggle = await screen.findByRole('switch', {
      name: 'Gravar ligações',
    })
    await waitFor(() =>
      expect(toggle.getAttribute('aria-checked')).toBe('false'),
    )
    expect(screen.queryByLabelText('Aviso de gravação')).toBeNull()

    fireEvent.click(toggle)
    const notice = (await screen.findByLabelText(
      'Aviso de gravação',
    )) as HTMLTextAreaElement
    expect(notice.value).toBe('Avise o contato: ligação gravada.')
    fireEvent.change(
      screen.getByLabelText('Guardar o áudio por quantos dias'),
      {
        target: { value: '30' },
      },
    )
    fireEvent.click(
      screen.getByRole('switch', { name: 'Transcrever e resumir ligações' }),
    )
    submit(notice)

    await waitFor(() =>
      expect(fetchBody(fetchSpy, SETTINGS, 'PATCH')).toEqual({
        callRecordingEnabled: true,
        callRecordingNotice: 'Avise o contato: ligação gravada.',
        callRecordingRetentionDays: 30,
        callTranscriptionEnabled: false,
      }),
    )
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Gravação de ligações salva'),
    )
  })

  it('refuses an out-of-range retention and an empty notice', async () => {
    const fetchSpy = setup(settings({ callRecordingEnabled: true }))
    renderWithQuery(<WhatsappSettingsCallRecording workspaceId='ws_1' />)

    const days = (await screen.findByLabelText(
      'Guardar o áudio por quantos dias',
    )) as HTMLInputElement
    await waitFor(() => expect(days.value).toBe('90'))

    fireEvent.change(days, { target: { value: '0' } })
    submit(days)
    expect(notify.error).toHaveBeenCalledWith('Guarde o áudio de 1 a 1825 dias')

    fireEvent.change(days, { target: { value: '10' } })
    fireEvent.change(screen.getByLabelText('Aviso de gravação'), {
      target: { value: '   ' },
    })
    submit(days)
    expect(notify.error).toHaveBeenCalledWith(
      'Escreva o aviso de gravação que o atendente lê ao contato',
    )
    expect(
      fetchSpy.mock.calls.some((call) => call[1]?.method === 'PATCH'),
    ).toBe(false)
  })

  it('renders nothing for non-admins', () => {
    mockFetch([])
    const { container } = renderWithQuery(
      <WorkspacePermissionsProvider
        value={{ isPrivileged: false, permissions: null }}
      >
        <WhatsappSettingsCallRecording workspaceId='ws_1' />
      </WorkspacePermissionsProvider>,
    )
    expect(container.innerHTML).toBe('')
  })
})
