import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WorkspacePermissionsProvider } from '@/app/_components/workspace/workspace-permissions'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import type {
  VoiceAgentRouteDTO,
  VoiceAgentSettingsDTO,
} from '@/types/voice-agent'
import { WhatsappSettingsVoiceAgent } from '../whatsapp-settings-voice-agent'

vi.setConfig({ testTimeout: 20_000 })

const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/notify', () => ({ notify }))

const BASE = '/api/workspaces/ws_1/voice-agent'
const SETTINGS = `${BASE}/settings`
const NOTICE = 'Este é um atendimento automatizado.'

function settings(
  overrides: Partial<VoiceAgentSettingsDTO> = {},
): VoiceAgentSettingsDTO {
  return {
    workspaceId: 'ws_1',
    enabled: false,
    noticeText: null,
    effectiveNotice: NOTICE,
    instructions: null,
    voice: 'alloy',
    maxCallSeconds: 300,
    monthlyMinutesCap: 300,
    silenceTimeoutSeconds: 20,
    runAsUserId: 'u_1',
    canOpenTickets: true,
    canLookupTickets: true,
    fallbackTarget: null,
    pabxSecretConfigured: false,
    pabxSecretHint: null,
    serverReady: true,
    ...overrides,
  }
}

function setup(
  saved: VoiceAgentSettingsDTO,
  routes: VoiceAgentRouteDTO[] = [],
) {
  return mockFetch([
    { method: 'PATCH', match: SETTINGS, data: saved },
    { match: SETTINGS, data: saved },
    {
      match: `${BASE}/usage`,
      data: {
        minutesUsed: 45,
        minutesCap: 300,
        calls: 6,
        periodStart: '2026-10-01T00:00:00.000Z',
      },
    },
    { match: `${BASE}/routes`, data: routes },
    {
      match: '/whatsapp/assignable-members',
      data: [
        { id: 'u_1', name: 'Conta de serviço', email: 's@x.com', image: null },
      ],
    },
  ])
}

function submit(element: HTMLElement) {
  const form = element.closest('form')
  if (form) fireEvent.submit(form)
}

describe('<WhatsappSettingsVoiceAgent />', () => {
  it('shows the month’s usage and the default notice as placeholder', async () => {
    setup(settings())
    renderWithQuery(<WhatsappSettingsVoiceAgent workspaceId='ws_1' />)

    expect(await screen.findByText('45 de 300 min · 6 ligações')).toBeTruthy()
    const notice = screen.getByLabelText(
      'Aviso falado no começo',
    ) as HTMLTextAreaElement
    await waitFor(() => expect(notice.placeholder).toBe(NOTICE))
    expect(
      screen
        .getByRole('progressbar', {
          name: 'Minutos do atendente de voz neste mês',
        })
        .getAttribute('aria-valuenow'),
    ).toBe('15')
  })

  it('turns the attendant on and saves every field', async () => {
    const fetchSpy = setup(settings())
    renderWithQuery(<WhatsappSettingsVoiceAgent workspaceId='ws_1' />)

    const toggle = await screen.findByRole('switch', {
      name: 'Ligar o atendente de voz',
    })
    await waitFor(() =>
      expect(toggle.getAttribute('aria-checked')).toBe('false'),
    )
    fireEvent.click(toggle)
    fireEvent.change(screen.getByLabelText('Aviso falado no começo'), {
      target: { value: '  Aviso próprio  ' },
    })
    fireEvent.change(screen.getByLabelText('Duração máxima (s)'), {
      target: { value: '180' },
    })
    fireEvent.change(screen.getByLabelText('Teto de minutos por mês'), {
      target: { value: '120' },
    })
    fireEvent.change(screen.getByLabelText('Silêncio tolerado (s)'), {
      target: { value: '15' },
    })
    fireEvent.change(
      screen.getByLabelText('Ramal ou fila que atende uma pessoa'),
      { target: { value: 'suporte' } },
    )
    fireEvent.click(screen.getByRole('switch', { name: 'Consultar chamado' }))
    submit(toggle)

    await waitFor(() =>
      expect(fetchBody(fetchSpy, SETTINGS, 'PATCH')).toEqual({
        enabled: true,
        noticeText: 'Aviso próprio',
        instructions: null,
        voice: 'alloy',
        maxCallSeconds: 180,
        monthlyMinutesCap: 120,
        silenceTimeoutSeconds: 15,
        runAsUserId: 'u_1',
        canOpenTickets: true,
        canLookupTickets: false,
        fallbackTarget: 'suporte',
      }),
    )
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Atendente de voz salvo'),
    )
  })

  it('refuses out-of-range limits and an attendant without an identity', async () => {
    const fetchSpy = setup(settings({ enabled: true, runAsUserId: null }))
    renderWithQuery(<WhatsappSettingsVoiceAgent workspaceId='ws_1' />)

    const maxCall = (await screen.findByLabelText(
      'Duração máxima (s)',
    )) as HTMLInputElement
    await waitFor(() => expect(maxCall.value).toBe('300'))

    fireEvent.change(maxCall, { target: { value: '5' } })
    submit(maxCall)
    expect(notify.error).toHaveBeenCalledWith(
      'A duração máxima vai de 30 a 900 segundos',
    )

    fireEvent.change(maxCall, { target: { value: '60' } })
    fireEvent.change(screen.getByLabelText('Teto de minutos por mês'), {
      target: { value: '0' },
    })
    submit(maxCall)
    expect(notify.error).toHaveBeenCalledWith(
      'Informe o teto de minutos por mês (número inteiro)',
    )

    fireEvent.change(screen.getByLabelText('Teto de minutos por mês'), {
      target: { value: '10' },
    })
    fireEvent.change(screen.getByLabelText('Silêncio tolerado (s)'), {
      target: { value: '1' },
    })
    submit(maxCall)
    expect(notify.error).toHaveBeenCalledWith(
      'O silêncio tolerado vai de 5 a 60 segundos',
    )

    fireEvent.change(screen.getByLabelText('Silêncio tolerado (s)'), {
      target: { value: '10' },
    })
    submit(maxCall)
    expect(notify.error).toHaveBeenCalledWith(
      'Escolha em nome de quem o atendente age',
    )
    expect(
      fetchSpy.mock.calls.some((call) => call[1]?.method === 'PATCH'),
    ).toBe(false)
  })

  it('warns when the server is not ready yet', async () => {
    setup(settings({ serverReady: false }))
    renderWithQuery(<WhatsappSettingsVoiceAgent workspaceId='ws_1' />)
    expect(
      await screen.findByText('Servidor ainda não está pronto'),
    ).toBeTruthy()
  })

  it('reports a failed save', async () => {
    mockFetch([
      {
        method: 'PATCH',
        match: SETTINGS,
        status: 422,
        error: 'Dados inválidos',
      },
      { match: SETTINGS, data: settings() },
      { match: `${BASE}/usage`, data: null },
      { match: `${BASE}/routes`, data: [] },
      { match: '/whatsapp/assignable-members', data: [] },
    ])
    renderWithQuery(<WhatsappSettingsVoiceAgent workspaceId='ws_1' />)
    const maxCall = await screen.findByLabelText('Duração máxima (s)')
    submit(maxCall)
    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith(
        expect.any(Error),
        'Não foi possível salvar',
      ),
    )
  })

  it('tells non-admins that only administrators configure it', () => {
    mockFetch([])
    renderWithQuery(
      <WorkspacePermissionsProvider
        value={{ isPrivileged: false, permissions: null }}
      >
        <WhatsappSettingsVoiceAgent workspaceId='ws_1' />
      </WorkspacePermissionsProvider>,
    )
    expect(
      screen.getByText(
        'Só administradores do workspace configuram o atendente de voz.',
      ),
    ).toBeTruthy()
  })
})
