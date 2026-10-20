import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WorkspacePermissionsProvider } from '@/app/_components/workspace/workspace-permissions'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import type { WhatsAppAutoOutreachDTO } from '@/types/whatsapp-auto-outreach'
import { WhatsappAutoOutreachPanel } from '../whatsapp-auto-outreach-panel'

vi.setConfig({ testTimeout: 20_000 })

const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/notify', () => ({ notify }))

const API = '/api/workspaces/ws_1/whatsapp'

function state(
  overrides: Partial<WhatsAppAutoOutreachDTO> = {},
): WhatsAppAutoOutreachDTO {
  return {
    status: 'PAUSED',
    connectionId: 'c1',
    templateId: 't1',
    intervalSeconds: 30,
    pending: 3,
    sent: 5,
    failed: 1,
    skipped: 0,
    lastSentAt: null,
    lastError: null,
    ...overrides,
  }
}

function setup(current: WhatsAppAutoOutreachDTO) {
  return mockFetch([
    {
      method: 'POST',
      match: `${API}/auto-outreach/play`,
      data: { ...current, status: 'RUNNING' },
    },
    {
      method: 'POST',
      match: `${API}/auto-outreach/pause`,
      data: { ...current, status: 'PAUSED' },
    },
    {
      method: 'POST',
      match: `${API}/auto-outreach/recipients`,
      data: { ...current, pending: 5, added: 2 },
    },
    { match: `${API}/auto-outreach`, data: current },
    { match: `${API}/connections`, data: [] },
    { match: `${API}/templates`, data: [] },
  ])
}

describe('<WhatsappAutoOutreachPanel />', () => {
  it('shows the queue counters and starts the run', async () => {
    const fetchSpy = setup(state())
    renderWithQuery(
      <WhatsappAutoOutreachPanel workspaceId='ws_1' selectedContactIds={[]} />,
    )

    expect(await screen.findByText('Pausado')).toBeTruthy()
    const play = screen.getByRole('button', { name: 'Iniciar disparo' })
    await waitFor(() =>
      expect((play as HTMLButtonElement).disabled).toBe(false),
    )
    fireEvent.click(play)

    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Disparo iniciado'),
    )
    expect(
      fetchSpy.mock.calls.some(([url]) =>
        String(url).includes('/auto-outreach/play'),
      ),
    ).toBe(true)
    expect(
      await screen.findByRole('button', { name: 'Pausar disparo' }),
    ).toBeTruthy()
  })

  it('queues the selected contacts', async () => {
    const onQueued = vi.fn()
    const fetchSpy = setup(state())
    renderWithQuery(
      <WhatsappAutoOutreachPanel
        workspaceId='ws_1'
        selectedContactIds={['ct1', 'ct2']}
        onQueued={onQueued}
      />,
    )

    fireEvent.click(
      await screen.findByRole('button', { name: 'Adicionar selecionados (2)' }),
    )

    await waitFor(() => expect(onQueued).toHaveBeenCalled())
    expect(fetchBody(fetchSpy, `${API}/auto-outreach/recipients`)).toEqual({
      contactIds: ['ct1', 'ct2'],
    })
  })

  it('shows the aggressiveness of the saved interval', async () => {
    setup(state({ intervalSeconds: 20 }))
    renderWithQuery(
      <WhatsappAutoOutreachPanel workspaceId='ws_1' selectedContactIds={[]} />,
    )

    expect(
      await screen.findByText('Agressivo · um envio a cada 20s'),
    ).toBeTruthy()
    expect(screen.getByText('Nível de agressividade')).toBeTruthy()
  })

  it('shows why the run paused itself', async () => {
    setup(state({ lastError: 'Limite mensal de mensagens atingido' }))
    renderWithQuery(
      <WhatsappAutoOutreachPanel workspaceId='ws_1' selectedContactIds={[]} />,
    )

    expect(
      await screen.findByText(/Limite mensal de mensagens atingido/),
    ).toBeTruthy()
  })

  it('hides the controls without the broadcasts permission', async () => {
    setup(state())
    renderWithQuery(
      <WorkspacePermissionsProvider
        value={{ isPrivileged: false, permissions: { broadcasts: ['VIEW'] } }}
      >
        <WhatsappAutoOutreachPanel workspaceId='ws_1' selectedContactIds={[]} />
      </WorkspacePermissionsProvider>,
    )

    expect(await screen.findByText('Pausado')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Iniciar disparo' })).toBeNull()
  })
})
