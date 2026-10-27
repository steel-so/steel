import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import type { WhatsAppArchiveOverviewDTO } from '@/types/whatsapp-archive'
import { WorkspaceWhatsappArchiveSection } from '../workspaces/workspace-whatsapp-archive-section'

vi.setConfig({ testTimeout: 20_000 })

const notify = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}))
vi.mock('@/lib/notify', () => ({ notify }))

const BASE = '/api/admin/workspaces/ws_1/whatsapp-archive'

function overview(
  enabled: boolean,
  offsite = true,
): WhatsAppArchiveOverviewDTO {
  return {
    settings: {
      enabled,
      rootFolderName: enabled ? 'BANCO' : null,
      effectiveRootFolderName: enabled ? 'BANCO' : 'ACME',
      updatedAt: null,
    },
    archives: [],
    retention: { weeklyDays: 90, monthlyMonths: 12 },
    offsiteConfigured: offsite,
  }
}

function setup(data: WhatsAppArchiveOverviewDTO, generateStatus = 202) {
  return mockFetch([
    { method: 'PATCH', match: BASE, data: data.settings },
    {
      method: 'POST',
      match: `${BASE}/generate`,
      status: generateStatus,
      ...(generateStatus >= 400
        ? { error: 'Já existe um pacote deste tipo sendo gerado.' }
        : { data: { id: 'a1' } }),
    },
    { match: BASE, data },
  ])
}

describe('<WorkspaceWhatsappArchiveSection />', () => {
  it('turns the archive on (off by default, generation locked)', async () => {
    const fetchSpy = setup(overview(false, false))
    renderWithQuery(<WorkspaceWhatsappArchiveSection workspaceId='ws_1' />)

    const toggle = await screen.findByRole('switch', {
      name: 'Arquivar conversas',
    })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(
      (
        screen.getByRole('button', {
          name: /Gerar semanal agora/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
    expect(
      screen.getByText(/BACKUP_OFFSITE_\* não está configurado/),
    ).toBeTruthy()

    fireEvent.click(toggle)
    await waitFor(() =>
      expect(fetchBody(fetchSpy, BASE, 'PATCH')).toEqual({ enabled: true }),
    )
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Arquivamento ativado'),
    )
  })

  it('saves the root folder, validating it first, and clears it', async () => {
    const fetchSpy = setup(overview(true))
    renderWithQuery(<WorkspaceWhatsappArchiveSection workspaceId='ws_1' />)

    const input = (await screen.findByLabelText(
      'Pasta raiz do .zip',
    )) as HTMLInputElement
    await waitFor(() => expect(input.value).toBe('BANCO'))

    fireEvent.change(input, { target: { value: 'ação' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar pasta' }))
    expect(notify.error).toHaveBeenCalledWith(
      'Use só letras sem acento, números, hífen e sublinhado',
    )

    fireEvent.change(input, { target: { value: ' FIDELIZZA ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar pasta' }))
    await waitFor(() =>
      expect(fetchBody(fetchSpy, BASE, 'PATCH')).toEqual({
        rootFolderName: 'FIDELIZZA',
      }),
    )
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Pasta raiz salva'),
    )

    fireEvent.change(input, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar pasta' }))
    await waitFor(() =>
      expect(
        fetchSpy.mock.calls.some(
          (call) =>
            call[1]?.method === 'PATCH' &&
            String(call[1]?.body) === JSON.stringify({ rootFolderName: null }),
        ),
      ).toBe(true),
    )
  })

  it('generates the weekly and the full package', async () => {
    const fetchSpy = setup(overview(true))
    renderWithQuery(<WorkspaceWhatsappArchiveSection workspaceId='ws_1' />)

    const weekly = await screen.findByRole('button', {
      name: /Gerar semanal agora/,
    })
    await waitFor(() =>
      expect((weekly as HTMLButtonElement).disabled).toBe(false),
    )
    fireEvent.click(weekly)
    await waitFor(() =>
      expect(fetchBody(fetchSpy, `${BASE}/generate`, 'POST')).toEqual({
        kind: 'WEEKLY',
      }),
    )
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Pacote semanal na fila'),
    )

    const full = screen.getByRole('button', { name: /Gerar completo agora/ })
    await waitFor(() =>
      expect((full as HTMLButtonElement).disabled).toBe(false),
    )
    fireEvent.click(full)
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Pacote completo na fila'),
    )
    expect(screen.getByText('Nenhum pacote gerado ainda.')).toBeTruthy()
  })

  it('reports refusals and a load error', async () => {
    setup(overview(true), 409)
    renderWithQuery(<WorkspaceWhatsappArchiveSection workspaceId='ws_1' />)
    const weekly = await screen.findByRole('button', {
      name: /Gerar semanal agora/,
    })
    await waitFor(() =>
      expect((weekly as HTMLButtonElement).disabled).toBe(false),
    )
    fireEvent.click(weekly)
    await waitFor(() => expect(notify.error).toHaveBeenCalled())
  })

  it('shows an error when the overview fails', async () => {
    mockFetch([{ match: BASE, status: 500, error: 'boom' }])
    renderWithQuery(<WorkspaceWhatsappArchiveSection workspaceId='ws_1' />)
    expect(
      await screen.findByText('Não foi possível carregar o arquivamento.'),
    ).toBeTruthy()
  })
})
