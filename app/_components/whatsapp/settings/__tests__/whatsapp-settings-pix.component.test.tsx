import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import type { WhatsAppPixSettingsDTO } from '@/types/whatsapp-pix'
import { WhatsappSettingsPix } from '../whatsapp-settings-pix'

vi.setConfig({ testTimeout: 20_000 })

const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/notify', () => ({ notify }))

const SETTINGS = '/api/workspaces/ws_1/whatsapp/pix/settings'

function pix(overrides: Partial<WhatsAppPixSettingsDTO> = {}) {
  return {
    workspaceId: 'ws_1',
    enabled: false,
    defaultExpiresMinutes: 60,
    provider: 'mock',
    isTestProvider: true,
    ...overrides,
  }
}

function setup(saved: WhatsAppPixSettingsDTO, patch = saved) {
  return mockFetch([
    { method: 'PATCH', match: SETTINGS, data: patch },
    { match: SETTINGS, data: saved },
  ])
}

describe('<WhatsappSettingsPix />', () => {
  it('is off by default, warns about the test provider and saves the switch', async () => {
    const fetchSpy = setup(pix(), pix({ enabled: true }))
    renderWithQuery(<WhatsappSettingsPix workspaceId='ws_1' />)

    const toggle = await screen.findByRole('switch', {
      name: 'Cobrar via Pix na conversa',
    })
    await waitFor(() =>
      expect(toggle.getAttribute('aria-checked')).toBe('false'),
    )
    expect(await screen.findByText(/provedor de teste/)).toBeTruthy()
    expect(screen.queryByText('Validade padrão da cobrança')).toBeNull()

    fireEvent.click(toggle)
    expect(await screen.findByText('Validade padrão da cobrança')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Salvar Pix' }))

    await waitFor(() =>
      expect(fetchBody(fetchSpy, SETTINGS, 'PATCH')).toEqual({
        enabled: true,
        defaultExpiresMinutes: 60,
      }),
    )
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Configuração do Pix salva'),
    )
  })

  it('loads the saved values, including an unusual validity', async () => {
    setup(pix({ enabled: true, defaultExpiresMinutes: 45 }))
    renderWithQuery(<WhatsappSettingsPix workspaceId='ws_1' />)

    const toggle = await screen.findByRole('switch', {
      name: 'Cobrar via Pix na conversa',
    })
    await waitFor(() =>
      expect(toggle.getAttribute('aria-checked')).toBe('true'),
    )
    expect(await screen.findByText('45 minutos')).toBeTruthy()
  })

  it('reports a failed save', async () => {
    mockFetch([
      { method: 'PATCH', match: SETTINGS, status: 403, error: 'Sem permissão' },
      { match: SETTINGS, data: pix() },
    ])
    renderWithQuery(<WhatsappSettingsPix workspaceId='ws_1' />)

    await screen.findByRole('switch', { name: 'Cobrar via Pix na conversa' })
    const save = screen.getByRole('button', { name: 'Salvar Pix' })
    await waitFor(() =>
      expect((save as HTMLButtonElement).disabled).toBe(false),
    )
    fireEvent.click(save)
    await waitFor(() => expect(notify.error).toHaveBeenCalled())
  })
})
