import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TvLinkDialog } from '@/app/_components/crm/dashboard/tv/tv-link-dialog'
import { fetchBody, mockFetch } from '@/src/__tests__/component-utils'

const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/notify', () => ({ notify }))

const link = {
  id: 'l1',
  dashboardId: 'd1',
  name: 'TV do atendimento',
  path: '/tv/tok-1',
  createdById: 'u1',
  lastUsedAt: null,
  revokedAt: null,
  createdAt: '2026-11-18T15:00:00.000Z',
}

function urls(spy: ReturnType<typeof mockFetch>): string[] {
  return spy.mock.calls.map((call) => String(call[0]))
}

describe('<TvLinkDialog basePath="whatsapp" />', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(async () => undefined) },
    })
  })

  it('lists, creates and revokes links through the Comunicação routes', async () => {
    const spy = mockFetch([
      { match: '/tv-links/l1', method: 'DELETE', data: null },
      {
        match: '/tv-links',
        method: 'POST',
        status: 201,
        data: { ...link, id: 'l2', name: 'Sala', path: '/tv/tok-2' },
      },
      { match: '/tv-links', data: [link] },
    ])
    render(
      <TvLinkDialog
        open
        onOpenChange={vi.fn()}
        workspaceId='ws1'
        dashboardId='d1'
        basePath='whatsapp'
      />,
    )
    expect(await screen.findByText('TV do atendimento')).toBeTruthy()
    expect(
      (screen.getByLabelText('Nome do link') as HTMLInputElement).value,
    ).toBe('TV do atendimento')

    fireEvent.change(screen.getByLabelText('Nome do link'), {
      target: { value: 'Sala' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Criar link/ }))
    await waitFor(() =>
      expect(screen.getAllByTestId('tv-link-row')).toHaveLength(2),
    )
    expect(fetchBody(spy, '/tv-links')).toEqual({ name: 'Sala' })

    fireEvent.click(
      screen.getByRole('button', { name: 'Revogar link TV do atendimento' }),
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Revogar' }))
    await waitFor(() =>
      expect(screen.getAllByTestId('tv-link-row')).toHaveLength(1),
    )

    const calls = urls(spy)
    expect(calls.length).toBeGreaterThan(0)
    for (const url of calls) {
      expect(url).toContain(
        '/api/workspaces/ws1/whatsapp/dashboards/d1/tv-links',
      )
    }
    expect(calls.some((url) => url.includes('/crm/'))).toBe(false)
  })

  it('names the Comunicação module when the member is not an admin', async () => {
    mockFetch([
      {
        match: '/tv-links',
        handler: () =>
          new Response(
            JSON.stringify({
              success: false,
              message: 'Permissão insuficiente',
              error: { code: 'FORBIDDEN' },
            }),
            { status: 403 },
          ),
      },
    ])
    render(
      <TvLinkDialog
        open
        onOpenChange={vi.fn()}
        workspaceId='ws1'
        dashboardId='d1'
        basePath='whatsapp'
      />,
    )
    expect(
      await screen.findByText(
        'Só donos e administradores da Comunicação gerenciam links da TV.',
      ),
    ).toBeTruthy()
  })
})
