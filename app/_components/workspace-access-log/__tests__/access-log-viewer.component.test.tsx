import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceAccessLogSection } from '@/app/_components/admin/workspaces/workspace-access-log-section'
import { WorkspaceSecurityPanel } from '@/app/_components/settings/security/workspace-security-panel'
import { mockFetch, renderWithQuery } from '@/src/__tests__/component-utils'
import type { WorkspaceAccessLogListDTO } from '@/types/workspace-access-log'
import {
  AccessLogViewer,
  formatAccessLogDateTime,
  formatDayKey,
} from '../access-log-viewer'

const notifyError = vi.hoisted(() => vi.fn())
vi.mock('@/lib/notify', () => ({
  notify: { error: notifyError, success: vi.fn() },
}))

vi.setConfig({ testTimeout: 20_000 })

const WS = 'ws_1'
const BASE = `/api/workspaces/${WS}/access-logs`

function list(
  overrides: Partial<WorkspaceAccessLogListDTO> = {},
): WorkspaceAccessLogListDTO {
  return {
    items: [
      {
        id: 'a1',
        userId: 'u_ana',
        userEmail: 'ana@acme.com.br',
        userName: 'Ana Souza',
        ip: '8.8.4.4',
        userAgent: 'Mozilla/5.0 (X11)',
        outcome: 'BLOCKED',
        surface: 'API',
        path: '/api/workspaces/ws_1/members',
        createdAt: '2026-10-27T13:04:05.000Z',
      },
      {
        id: 'a2',
        userId: 'u_gone',
        userEmail: null,
        userName: null,
        ip: null,
        userAgent: null,
        outcome: 'ALLOWED',
        surface: 'APP',
        path: null,
        createdAt: '2026-10-27T12:00:00.000Z',
      },
    ],
    total: 2,
    page: 1,
    pageSize: 50,
    period: {
      from: '2026-09-28',
      to: '2026-10-27',
      timezone: 'America/Sao_Paulo',
    },
    allowedIps: ['10.0.0.0/8', '200.1.2.3'],
    ...overrides,
  }
}

async function pick(label: string, option: string) {
  const select = screen.getByRole('combobox', { name: label })
  fireEvent.click(select)
  const item = await screen.findByRole('option', { name: option })
  fireEvent.pointerDown(item, { pointerType: 'mouse' })
  fireEvent.click(item)
  await waitFor(() => expect(select.textContent).toContain(option))
}

const listUrls = (spy: ReturnType<typeof mockFetch>) =>
  spy.mock.calls
    .map(([input]) => String(input))
    .filter((url) => !url.includes('/export'))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('format helpers', () => {
  it('formats in São Paulo, not in the browser zone', () => {
    expect(formatAccessLogDateTime('2026-10-28T02:30:00.000Z')).toBe(
      '27/10/2026, 23:30:00',
    )
    expect(formatDayKey('2026-10-01')).toBe('01/10/2026')
  })
})

describe('AccessLogViewer', () => {
  it('lists the attempts with outcome, channel, IP and time', async () => {
    mockFetch([{ match: BASE, data: list() }])
    renderWithQuery(<AccessLogViewer basePath={BASE} />)

    expect(await screen.findByText('Ana Souza')).toBeTruthy()
    expect(screen.getByText(/ana@acme\.com\.br/)).toBeTruthy()
    expect(screen.getByText('8.8.4.4')).toBeTruthy()
    expect(screen.getByText('Bloqueado')).toBeTruthy()
    expect(screen.getByText('Permitido')).toBeTruthy()
    expect(screen.getByText('API')).toBeTruthy()
    expect(screen.getByText('App')).toBeTruthy()
    expect(screen.getByText('27/10/2026, 10:04:05')).toBeTruthy()
    // A deleted user without a snapshot still shows the id.
    expect(screen.getByText('u_gone')).toBeTruthy()
    expect(screen.getByText('IP desconhecido')).toBeTruthy()
    expect(screen.getByText(/28\/09\/2026 a 27\/10\/2026/)).toBeTruthy()
    expect(screen.getByText('1–2 de 2')).toBeTruthy()
    // The allowlist is only shown in Ajustes › Segurança.
    expect(screen.queryByText('Redes permitidas')).toBeNull()
  })

  it('sends the filters and resets to the first page', async () => {
    const spy = mockFetch([
      { match: BASE, data: list({ total: 120, page: 1 }) },
    ])
    renderWithQuery(<AccessLogViewer basePath={BASE} />)
    await screen.findByText('Ana Souza')

    fireEvent.click(screen.getByRole('button', { name: 'Próxima' }))
    await waitFor(() =>
      expect(listUrls(spy).some((url) => url.includes('page=2'))).toBe(true),
    )

    await pick('Resultado', 'Só bloqueados')
    await pick('Canal', 'Só API')
    fireEvent.change(screen.getByLabelText('De'), {
      target: { value: '2026-10-01' },
    })
    fireEvent.change(screen.getByLabelText('Até'), {
      target: { value: '2026-10-20' },
    })
    const user = screen.getByLabelText('Usuário')
    fireEvent.change(user, { target: { value: ' ana ' } })
    fireEvent.blur(user)

    await waitFor(() => {
      const last = listUrls(spy).at(-1) ?? ''
      expect(last).toContain('outcome=BLOCKED')
      expect(last).toContain('surface=API')
      expect(last).toContain('from=2026-10-01')
      expect(last).toContain('to=2026-10-20')
      expect(last).toContain('user=ana')
      expect(last).toContain('page=1')
    })

    await pick('Resultado', 'Permitidos e bloqueados')
    await waitFor(() => expect(listUrls(spy).at(-1)).not.toContain('outcome='))

    fireEvent.change(screen.getByLabelText('De'), { target: { value: '' } })
    fireEvent.change(user, { target: { value: '' } })
    fireEvent.submit(user.closest('form') as HTMLFormElement)
    await waitFor(() => {
      const last = listUrls(spy).at(-1) ?? ''
      expect(last).not.toContain('from=')
      expect(last).not.toContain('user=')
    })
  })

  it('goes back a page', async () => {
    const spy = mockFetch([
      {
        match: BASE,
        handler: (url) =>
          list({
            total: 120,
            page: Number(new URL(url, 'http://x').searchParams.get('page')),
          }),
      },
    ])
    renderWithQuery(<AccessLogViewer basePath={BASE} />)
    await screen.findByText('1–50 de 120')
    fireEvent.click(screen.getByRole('button', { name: 'Próxima' }))
    await screen.findByText('51–100 de 120')
    fireEvent.click(screen.getByRole('button', { name: 'Anterior' }))
    await screen.findByText('1–50 de 120')
    expect(listUrls(spy).at(-1)).toContain('page=1')
  })

  it('shows the empty and error states', async () => {
    mockFetch([{ match: BASE, data: list({ items: [], total: 0 }) }])
    const { unmount } = renderWithQuery(<AccessLogViewer basePath={BASE} />)
    expect(
      await screen.findByText('Nenhuma entrada com esses filtros.'),
    ).toBeTruthy()
    unmount()

    mockFetch([{ match: BASE, status: 403, error: 'Permissão insuficiente' }])
    renderWithQuery(<AccessLogViewer basePath={BASE} />)
    expect(await screen.findByText('Permissão insuficiente')).toBeTruthy()
  })

  it('downloads the CSV with the current filters', async () => {
    const createObjectURL = vi.fn(() => 'blob:x')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL, revokeObjectURL }),
    )
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {})
    const spy = mockFetch([
      {
        match: `${BASE}/export`,
        handler: () =>
          new Response('csv', {
            headers: {
              'Content-Disposition':
                'attachment; filename="acessos-2026-10-01_2026-10-27.csv"',
            },
          }),
      },
      { match: BASE, data: list() },
    ])
    renderWithQuery(<AccessLogViewer basePath={BASE} />)
    await screen.findByText('Ana Souza')
    await pick('Resultado', 'Só bloqueados')

    fireEvent.click(screen.getByRole('button', { name: 'Exportar CSV' }))
    await waitFor(() => expect(click).toHaveBeenCalled())
    const exportUrl = spy.mock.calls
      .map(([input]) => String(input))
      .find((url) => url.includes('/export'))
    expect(exportUrl).toBe(`${BASE}/export?outcome=BLOCKED`)
    expect(createObjectURL).toHaveBeenCalled()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:x')
    expect(notifyError).not.toHaveBeenCalled()
  })

  it('shows the server message when the export is refused', async () => {
    mockFetch([
      {
        match: `${BASE}/export`,
        status: 422,
        error: 'O período tem 200000 entradas',
      },
      { match: BASE, data: list() },
    ])
    renderWithQuery(<AccessLogViewer basePath={BASE} />)
    await screen.findByText('Ana Souza')
    fireEvent.click(screen.getByRole('button', { name: 'Exportar CSV' }))
    await waitFor(() =>
      expect(notifyError).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'O período tem 200000 entradas' }),
      ),
    )
    expect(screen.getByRole('button', { name: 'Exportar CSV' })).toBeTruthy()
  })
})

describe('WorkspaceSecurityPanel (Ajustes › Segurança)', () => {
  it('shows the allowlist read-only above the log', async () => {
    mockFetch([{ match: BASE, data: list() }])
    renderWithQuery(<WorkspaceSecurityPanel workspaceId={WS} />)
    expect(await screen.findByText('Redes permitidas')).toBeTruthy()
    expect(screen.getByText('10.0.0.0/8')).toBeTruthy()
    expect(screen.getByText('200.1.2.3')).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: /IPs/ })).toBeNull()
  })

  it('explains when the workspace has no restriction', async () => {
    mockFetch([
      { match: BASE, data: list({ allowedIps: [], items: [], total: 0 }) },
    ])
    renderWithQuery(<WorkspaceSecurityPanel workspaceId={WS} />)
    expect(await screen.findByText(/Sem restrição de IP/)).toBeTruthy()
  })
})

describe('WorkspaceAccessLogSection (admin)', () => {
  it('reads the admin API', async () => {
    const spy = mockFetch([
      { match: `/api/admin/workspaces/${WS}/access-logs`, data: list() },
    ])
    renderWithQuery(<WorkspaceAccessLogSection workspaceId={WS} restricted />)
    expect(await screen.findByText('Ana Souza')).toBeTruthy()
    expect(
      screen.getByText('Registro de acessos (rede permitida)'),
    ).toBeTruthy()
    expect(String(spy.mock.calls[0][0])).toContain(
      `/api/admin/workspaces/${WS}/access-logs`,
    )
  })

  it('says nothing new is logged without an allowlist', async () => {
    mockFetch([
      {
        match: `/api/admin/workspaces/${WS}/access-logs`,
        data: list({ allowedIps: [] }),
      },
    ])
    renderWithQuery(
      <WorkspaceAccessLogSection workspaceId={WS} restricted={false} />,
    )
    expect(
      await screen.findByText(/Sem allowlist de IPs: nada novo é registrado/),
    ).toBeTruthy()
  })
})
