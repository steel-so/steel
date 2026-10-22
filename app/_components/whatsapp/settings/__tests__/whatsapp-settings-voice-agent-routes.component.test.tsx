import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import { fakeVoiceAgentSecret } from '@/src/__tests__/helpers/fake-tokens'
import type {
  VoiceAgentRouteDTO,
  VoiceAgentSettingsDTO,
} from '@/types/voice-agent'
import { WhatsappSettingsVoiceAgentRoutes } from '../whatsapp-settings-voice-agent-routes'

vi.setConfig({ testTimeout: 20_000 })

const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/notify', () => ({ notify }))

const BASE = '/api/workspaces/ws_1/voice-agent'
const SECRET = fakeVoiceAgentSecret()

const ROUTE: VoiceAgentRouteDTO = {
  id: 'r_1',
  kind: 'QUEUE',
  value: 'suporte',
  label: 'Suporte N1',
  enabled: true,
  transferTarget: '200',
}

function settings(
  overrides: Partial<VoiceAgentSettingsDTO> = {},
): VoiceAgentSettingsDTO {
  return {
    workspaceId: 'ws_1',
    enabled: true,
    noticeText: null,
    effectiveNotice: 'x',
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

function setup(routes: VoiceAgentRouteDTO[], saved = settings()) {
  return mockFetch([
    { method: 'POST', match: `${BASE}/routes`, data: ROUTE, status: 201 },
    { method: 'PATCH', match: `${BASE}/routes/r_1`, data: ROUTE },
    { method: 'DELETE', match: `${BASE}/routes/r_1`, data: { id: 'r_1' } },
    { match: `${BASE}/routes`, data: routes },
    {
      method: 'POST',
      match: `${BASE}/secret`,
      data: { secret: SECRET, hint: '1234' },
    },
    { match: `${BASE}/settings`, data: saved },
  ])
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('<WhatsappSettingsVoiceAgentRoutes />', () => {
  it('explains that without routes nothing is answered', async () => {
    setup([])
    renderWithQuery(<WhatsappSettingsVoiceAgentRoutes workspaceId='ws_1' />)
    expect(
      await screen.findByText(/Sem isso o atendente não atende/),
    ).toBeTruthy()
  })

  it('lists the routes with their human destination', async () => {
    setup([
      ROUTE,
      {
        ...ROUTE,
        id: 'r_2',
        kind: 'DID',
        value: '1140041234',
        label: null,
        transferTarget: null,
      },
    ])
    renderWithQuery(<WhatsappSettingsVoiceAgentRoutes workspaceId='ws_1' />)
    expect(await screen.findByText('suporte')).toBeTruthy()
    expect(screen.getByText('Suporte N1 · Pessoa: 200')).toBeTruthy()
    expect(screen.getByText('1140041234')).toBeTruthy()
    expect(screen.getByText('Pessoa: destino geral')).toBeTruthy()
  })

  it('adds a queue and clears the form', async () => {
    const fetchSpy = setup([])
    renderWithQuery(<WhatsappSettingsVoiceAgentRoutes workspaceId='ws_1' />)

    const value = (await screen.findByLabelText(
      'Nome da fila',
    )) as HTMLInputElement
    fireEvent.change(value, { target: { value: ' suporte ' } })
    fireEvent.change(screen.getByLabelText('Nome para você (opcional)'), {
      target: { value: 'Suporte N1' },
    })
    fireEvent.change(
      screen.getByLabelText('Ramal ou fila de uma pessoa (opcional)'),
      { target: { value: '200' } },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }))

    await waitFor(() =>
      expect(fetchBody(fetchSpy, `${BASE}/routes`, 'POST')).toEqual({
        kind: 'QUEUE',
        value: 'suporte',
        label: 'Suporte N1',
        transferTarget: '200',
      }),
    )
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Fila ou número adicionado'),
    )
    await waitFor(() => expect(value.value).toBe(''))
  })

  it('does not add an empty route', async () => {
    const fetchSpy = setup([])
    renderWithQuery(<WhatsappSettingsVoiceAgentRoutes workspaceId='ws_1' />)
    fireEvent.click(await screen.findByRole('button', { name: 'Adicionar' }))
    expect(notify.error).toHaveBeenCalledWith(
      'Informe o nome da fila ou o número discado',
    )
    expect(fetchSpy.mock.calls.some((call) => call[1]?.method === 'POST')).toBe(
      false,
    )
  })

  it('turns a route off and removes it', async () => {
    const fetchSpy = setup([ROUTE])
    renderWithQuery(<WhatsappSettingsVoiceAgentRoutes workspaceId='ws_1' />)

    fireEvent.click(
      await screen.findByRole('switch', { name: 'Atender suporte' }),
    )
    await waitFor(() =>
      expect(fetchBody(fetchSpy, `${BASE}/routes/r_1`, 'PATCH')).toEqual({
        enabled: false,
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Remover' }))
    await waitFor(() =>
      expect(
        fetchSpy.mock.calls.some(
          (call) =>
            String(call[0]).includes(`${BASE}/routes/r_1`) &&
            call[1]?.method === 'DELETE',
        ),
      ).toBe(true),
    )
  })

  it('reports failures to add, toggle and remove', async () => {
    mockFetch([
      {
        method: 'POST',
        match: `${BASE}/routes`,
        status: 409,
        error: 'Já existe',
      },
      { method: 'PATCH', match: `${BASE}/routes/r_1`, status: 500, error: 'x' },
      {
        method: 'DELETE',
        match: `${BASE}/routes/r_1`,
        status: 500,
        error: 'x',
      },
      { match: `${BASE}/routes`, data: [ROUTE] },
      { match: `${BASE}/settings`, data: settings() },
    ])
    renderWithQuery(<WhatsappSettingsVoiceAgentRoutes workspaceId='ws_1' />)

    fireEvent.change(await screen.findByLabelText('Nome da fila'), {
      target: { value: 'suporte' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }))
    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith(
        expect.any(Error),
        'Não foi possível adicionar',
      ),
    )
    fireEvent.click(screen.getByRole('switch', { name: 'Atender suporte' }))
    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith(
        expect.any(Error),
        'Não foi possível atualizar',
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Remover' }))
    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith(
        expect.any(Error),
        'Não foi possível remover',
      ),
    )
  })

  it('generates the secret, shows it once and copies it', async () => {
    setup([])
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    renderWithQuery(<WhatsappSettingsVoiceAgentRoutes workspaceId='ws_1' />)

    expect(await screen.findByText('Nenhum segredo gerado ainda.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Gerar segredo' }))
    expect(await screen.findByText(SECRET)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Copiar segredo' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(SECRET))
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Segredo copiado'),
    )

    writeText.mockRejectedValueOnce(new Error('denied'))
    fireEvent.click(screen.getByRole('button', { name: 'Copiar segredo' }))
    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith('Não foi possível copiar'),
    )
  })

  it('shows the hint of an existing secret and offers a new one', async () => {
    setup([], settings({ pabxSecretConfigured: true, pabxSecretHint: 'wxyz' }))
    renderWithQuery(<WhatsappSettingsVoiceAgentRoutes workspaceId='ws_1' />)
    expect(
      await screen.findByText('Segredo configurado (termina em wxyz).'),
    ).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Gerar novo segredo' }),
    ).toBeTruthy()
  })

  it('reports a failure to generate the secret', async () => {
    mockFetch([
      { method: 'POST', match: `${BASE}/secret`, status: 500, error: 'x' },
      { match: `${BASE}/routes`, data: [] },
      { match: `${BASE}/settings`, data: settings() },
    ])
    renderWithQuery(<WhatsappSettingsVoiceAgentRoutes workspaceId='ws_1' />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Gerar segredo' }),
    )
    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith(
        expect.any(Error),
        'Não foi possível gerar',
      ),
    )
  })
})
