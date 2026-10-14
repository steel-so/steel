import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WorkspacePermissionsProvider } from '@/app/_components/workspace/workspace-permissions'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import type { WhatsAppUsageDTO } from '@/types/whatsapp-usage'
import { WhatsAppUsageSection } from '../whatsapp-usage-section'

vi.setConfig({ testTimeout: 20_000 })

const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/notify', () => ({ notify }))

const URL = '/api/workspaces/ws_1/whatsapp/usage'

function usage(overrides?: Partial<WhatsAppUsageDTO>): WhatsAppUsageDTO {
  return {
    workspaceId: 'ws_1',
    period: '2026-10',
    canManage: true,
    conversations: { used: 400, limit: 500, percent: 80, reached: false },
    messages: { used: 1200, limit: null, percent: null, reached: false },
    ...overrides,
  }
}

function renderAs(isPrivileged: boolean) {
  return renderWithQuery(
    <WorkspacePermissionsProvider value={{ isPrivileged, permissions: {} }}>
      <WhatsAppUsageSection workspaceId='ws_1' />
    </WorkspacePermissionsProvider>,
  )
}

describe('<WhatsAppUsageSection />', () => {
  it('shows the month usage against each limit', async () => {
    mockFetch([{ match: URL, data: usage() }])
    renderAs(false)

    expect(await screen.findByText('Conversas')).toBeTruthy()
    expect(screen.getByText(/de 500 conversas/)).toBeTruthy()
    expect(screen.getByText(/mensagens · sem limite/)).toBeTruthy()
    // Only the limited metric has a progress bar.
    const bars = screen.getAllByRole('progressbar')
    expect(bars).toHaveLength(1)
    expect(bars[0].getAttribute('aria-valuenow')).toBe('80')
    expect(screen.getAllByText(/outubro de 2026/).length).toBeGreaterThan(0)
  })

  it('explains the block when a limit is reached', async () => {
    mockFetch([
      {
        match: URL,
        data: usage({
          messages: { used: 100, limit: 100, percent: 100, reached: true },
        }),
      },
    ])
    renderAs(false)

    expect(
      await screen.findByText(/os envios ficam bloqueados até o próximo mês/),
    ).toBeTruthy()
  })

  it('hides the form from a non-admin', async () => {
    mockFetch([{ match: URL, data: usage({ canManage: false }) }])
    renderAs(false)

    expect(
      await screen.findByText(/Apenas o dono e os administradores/),
    ).toBeTruthy()
    expect(screen.queryByLabelText('Conversas por mês')).toBeNull()
  })

  it('lets an admin save limits (blank = unlimited, dots allowed)', async () => {
    const fetchSpy = mockFetch([
      {
        method: 'PATCH',
        match: URL,
        data: usage({
          conversations: {
            used: 400,
            limit: null,
            percent: null,
            reached: false,
          },
          messages: { used: 1200, limit: 10000, percent: 12, reached: false },
        }),
      },
      { match: URL, data: usage() },
    ])
    renderAs(true)

    const conversations = (await screen.findByLabelText(
      'Conversas por mês',
    )) as HTMLInputElement
    expect(conversations.value).toBe('500')
    fireEvent.change(conversations, { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Mensagens por mês'), {
      target: { value: '10.000' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar limites' }))

    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith(
        'Limites da Comunicação salvos',
      ),
    )
    expect(fetchBody(fetchSpy, URL, 'PATCH')).toEqual({
      monthlyConversationLimit: null,
      monthlyMessageLimit: 10000,
    })
  })

  it('refuses an invalid limit without calling the API', async () => {
    const fetchSpy = mockFetch([{ match: URL, data: usage() }])
    renderAs(true)

    fireEvent.change(await screen.findByLabelText('Mensagens por mês'), {
      target: { value: '0' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar limites' }))

    expect(notify.error).toHaveBeenCalled()
    expect(fetchBody(fetchSpy, URL, 'PATCH')).toBeUndefined()
  })
})
