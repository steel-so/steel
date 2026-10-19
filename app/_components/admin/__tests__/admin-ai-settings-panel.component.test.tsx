import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import type { PlatformAiSettingsDTO } from '@/types/platform-ai-settings'
import { AdminAiSettingsPanel } from '../ai/admin-ai-settings-panel'

const notify = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}))
vi.mock('@/lib/notify', () => ({ notify }))

const SETTINGS: PlatformAiSettingsDTO = {
  costMargin: 1,
  updatedAt: null,
  models: [
    {
      key: 'openai:gpt-4o-mini',
      provider: 'openai',
      label: 'GPT-4o mini',
      inputUsdPer1M: 0.15,
      outputUsdPer1M: 0.6,
      cachedInputUsdPer1M: null,
      chargedInputUsdPer1M: 0.15,
      chargedOutputUsdPer1M: 0.6,
    },
  ],
  embeddingsEnabled: true,
  knowledgeSearch: {
    providerConfigured: true,
    vectorIndexReady: false,
    mode: 'text',
  },
}

describe('<AdminAiSettingsPanel />', () => {
  it('shows the margin and the price table', () => {
    renderWithQuery(<AdminAiSettingsPanel initial={SETTINGS} />)
    expect(
      (screen.getByLabelText('Margem (×)') as HTMLInputElement).value,
    ).toBe('1')
    expect(screen.getByText('GPT-4o mini')).toBeTruthy()
    expect(screen.getByText('—')).toBeTruthy()
    expect(screen.getByText(/Usando o padrão da plataforma/)).toBeTruthy()
    expect(
      (
        screen.getByRole('button', {
          name: 'Salvar margem',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
  })

  it('saves a new margin with the reason', async () => {
    const spy = mockFetch([
      {
        method: 'PATCH',
        match: '/api/admin/ai',
        data: {
          ...SETTINGS,
          costMargin: 1.5,
          updatedAt: '2026-10-06T12:00:00.000Z',
        },
      },
    ])
    renderWithQuery(<AdminAiSettingsPanel initial={SETTINGS} />)

    fireEvent.change(screen.getByLabelText('Margem (×)'), {
      target: { value: '1,5' },
    })
    fireEvent.change(screen.getByLabelText('Motivo (opcional)'), {
      target: { value: 'Impostos' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar margem' }))

    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Margem de IA salva'),
    )
    expect(fetchBody(spy, '/api/admin/ai', 'PATCH')).toEqual({
      costMargin: 1.5,
      reason: 'Impostos',
    })
    expect(screen.getByText(/Última alteração/)).toBeTruthy()
  })

  it('refuses an invalid margin without calling the API', () => {
    const spy = mockFetch([])
    renderWithQuery(<AdminAiSettingsPanel initial={SETTINGS} />)
    fireEvent.change(screen.getByLabelText('Margem (×)'), {
      target: { value: 'abc' },
    })
    fireEvent.submit(
      screen
        .getByRole('button', { name: 'Salvar margem' })
        .closest('form') as HTMLFormElement,
    )
    expect(notify.error).toHaveBeenCalled()
    expect(spy).not.toHaveBeenCalled()
  })

  it('shows the knowledge search state and switches embeddings off', async () => {
    const spy = mockFetch([
      {
        method: 'PATCH',
        match: '/api/admin/ai',
        data: { ...SETTINGS, embeddingsEnabled: false },
      },
    ])
    renderWithQuery(<AdminAiSettingsPanel initial={SETTINGS} />)
    expect(screen.getByText('Chave da OpenAI configurada')).toBeTruthy()
    expect(screen.getByText('pgvector não instalado')).toBeTruthy()
    expect(screen.getByText('Modo: só texto')).toBeTruthy()

    fireEvent.click(
      screen.getByRole('switch', { name: 'Busca semântica (embeddings)' }),
    )

    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith(
        'Busca semântica desligada: a busca segue só por texto',
      ),
    )
    expect(fetchBody(spy, '/api/admin/ai', 'PATCH')).toEqual({
      costMargin: 1,
      embeddingsEnabled: false,
    })
  })
})
