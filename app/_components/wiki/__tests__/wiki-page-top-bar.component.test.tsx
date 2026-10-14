import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  apiSuccess,
  createTestQueryClient,
  getFetchCall,
  mockFetch,
  renderWithProviders,
} from '@/src/__tests__/helpers/component'
import type { WikiPageDTO } from '@/types/wiki-page'
import { WikiPageTopBar, type WikiPageTopBarProps } from '../wiki-page-top-bar'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
const notify = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}))
vi.mock('@/lib/notify', () => ({ notify }))

const WORKSPACE_ID = 'ws-1'
const PAGE_URL = `/api/workspaces/${WORKSPACE_ID}/wiki/page-1`

function buildPage(overrides: Partial<WikiPageDTO> = {}): WikiPageDTO {
  return {
    id: 'page-1',
    workspaceId: WORKSPACE_ID,
    parentId: null,
    title: 'Manual',
    icon: null,
    coverImage: null,
    content: [],
    position: 0,
    labelIds: [],
    createdById: 'user-1',
    updatedById: null,
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function renderBar(
  page = buildPage(),
  props: Partial<WikiPageTopBarProps> = {},
) {
  const fetchSpy = mockFetch().mockImplementation(async () =>
    apiSuccess(buildPage({ id: 'copy-1' })),
  )
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(['wiki-pages', WORKSPACE_ID], [page])
  const onExport = vi.fn()
  const utils = renderWithProviders(
    <WikiPageTopBar
      workspaceId={WORKSPACE_ID}
      workspaceSlug='acme'
      page={page}
      title={page.title}
      ancestors={[]}
      status='synced'
      presence={[]}
      userId='user-1'
      readOnly={false}
      fullWidth={false}
      onFullWidthChange={vi.fn()}
      fixedToolbar
      onFixedToolbarChange={vi.fn()}
      onToggleNavigation={vi.fn()}
      getMarkdown={() => '# Manual'}
      onExport={onExport}
      {...props}
    />,
    { queryClient },
  )
  return { ...utils, fetchSpy, onExport }
}

beforeEach(() => {
  push.mockReset()
  notify.success.mockReset()
  notify.error.mockReset()
})

describe('<WikiPageTopBar /> publish', () => {
  it('publishes an unpublished page', async () => {
    const { user, fetchSpy } = renderBar()

    expect(screen.queryByRole('link', { name: /Ao vivo/ })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Publicar' }))

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
    expect(getFetchCall(fetchSpy)).toMatchObject({
      url: `${PAGE_URL}/publish`,
      method: 'POST',
    })
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Página publicada na web'),
    )
  })

  it('shows the live link and offers to unpublish a published page', async () => {
    const { user, fetchSpy } = renderBar(
      buildPage({
        publishedAt: '2026-10-01T00:00:00.000Z',
        publicToken: 'tok-123',
      }),
    )

    const live = screen.getByRole('link', { name: /Ao vivo/ })
    expect(live.getAttribute('href')).toBe('/w/tok-123')
    expect(live.getAttribute('target')).toBe('_blank')

    await user.click(
      screen.getByRole('button', { name: 'Cancelar publicação' }),
    )
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
    expect(getFetchCall(fetchSpy)).toMatchObject({
      url: `${PAGE_URL}/publish`,
      method: 'DELETE',
    })
  })

  it('reports a failed publish', async () => {
    const { user, fetchSpy } = renderBar()
    fetchSpy.mockImplementation(async () =>
      Response.json({ message: 'Sem permissão' }, { status: 403 }),
    )

    await user.click(screen.getByRole('button', { name: 'Publicar' }))
    await waitFor(() => expect(notify.error).toHaveBeenCalled())
  })
})

describe('<WikiPageTopBar /> lock', () => {
  it('lets the author lock the page', async () => {
    const { user, fetchSpy } = renderBar(buildPage({ canManageLock: true }))

    await user.click(screen.getByRole('button', { name: 'Bloquear edição' }))
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
    expect(getFetchCall(fetchSpy)).toMatchObject({
      url: `${PAGE_URL}/lock`,
      method: 'POST',
    })
  })

  it('unlocks a locked page for who manages it', async () => {
    const { user, fetchSpy } = renderBar(
      buildPage({ canManageLock: true, lockedAt: '2026-10-01T00:00:00Z' }),
    )

    expect(screen.queryByText('Somente leitura')).toBeNull()
    const button = screen.getByRole('button', { name: 'Desbloquear edição' })
    expect(button.getAttribute('aria-pressed')).toBe('true')
    await user.click(button)
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
    expect(getFetchCall(fetchSpy).method).toBe('DELETE')
  })

  it('shows a read-only page to who cannot unlock it', () => {
    renderBar(
      buildPage({ canManageLock: false, lockedAt: '2026-10-01T00:00:00Z' }),
      { readOnly: true },
    )

    expect(screen.getByText('Somente leitura')).toBeTruthy()
    const lock = screen.getByRole('button', { name: 'Desbloquear edição' })
    expect(lock.hasAttribute('disabled')).toBe(true)
    expect(
      screen.getByRole('button', { name: 'Publicar' }).hasAttribute('disabled'),
    ).toBe(true)
  })

  it('keeps the lock disabled while the backend does not say who manages it', () => {
    renderBar()
    expect(
      screen
        .getByRole('button', { name: 'Bloquear edição' })
        .hasAttribute('disabled'),
    ).toBe(true)
  })
})

describe('<WikiPageTopBar /> favorite and link', () => {
  it('favorites the page optimistically', async () => {
    const { user, fetchSpy } = renderBar()

    await user.click(
      screen.getByRole('button', { name: 'Adicionar aos favoritos' }),
    )
    expect(
      screen
        .getByRole('button', { name: 'Remover dos favoritos' })
        .getAttribute('aria-pressed'),
    ).toBe('true')
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
    expect(getFetchCall(fetchSpy)).toMatchObject({
      url: `${PAGE_URL}/favorite`,
      method: 'PUT',
    })
  })

  it('rolls the star back when favoriting fails', async () => {
    const { user, fetchSpy } = renderBar(buildPage({ isFavorite: true }))
    fetchSpy.mockImplementation(async () =>
      Response.json({ message: 'Falhou' }, { status: 500 }),
    )

    await user.click(
      screen.getByRole('button', { name: 'Remover dos favoritos' }),
    )
    await waitFor(() => expect(notify.error).toHaveBeenCalled())
    expect(
      screen.getByRole('button', { name: 'Remover dos favoritos' }),
    ).toBeTruthy()
    expect(getFetchCall(fetchSpy).method).toBe('DELETE')
  })

  it('copies the in-app link', async () => {
    const { user } = renderBar()

    await user.click(screen.getByRole('button', { name: 'Copiar link' }))

    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Link copiado'),
    )
    expect(await navigator.clipboard.readText()).toBe(
      `${window.location.origin}/acme/wiki/page-1`,
    )
  })
})

describe('<WikiPageTopBar /> presence and status', () => {
  it('stacks who is online, with the overflow as +N', () => {
    renderBar(buildPage(), {
      presence: [
        { id: 'user-1', name: 'Ana', image: null, color: 'red' },
        { id: 'user-2', name: 'Bruno Lima', image: null, color: 'blue' },
        { id: 'user-3', name: 'Carla', image: null, color: 'green' },
        { id: 'user-4', name: 'Davi', image: null, color: 'gray' },
        { id: 'user-5', name: 'Eva', image: null, color: 'pink' },
      ],
    })

    const list = screen.getByRole('list', { name: 'Pessoas nesta página' })
    expect(within(list).getByLabelText('Ana (você)')).toBeTruthy()
    expect(within(list).getByLabelText('Bruno Lima')).toBeTruthy()
    expect(within(list).getByText('BL')).toBeTruthy()
    expect(within(list).getByLabelText('Mais 2 pessoas').textContent).toBe('+2')
  })

  it('names the sync state for screen readers', () => {
    renderBar(buildPage(), { status: 'offline' })
    const status = screen.getByRole('status')
    expect(status.getAttribute('data-status')).toBe('offline')
    expect(status.textContent).toBe('Sem conexão')
  })

  it('shows the panel toggle only when asked to', async () => {
    const onToggle = vi.fn()
    const { user, rerender } = renderBar()
    expect(
      screen.queryByRole('button', { name: 'Abrir painel lateral' }),
    ).toBeNull()

    rerender(
      <WikiPageTopBar
        workspaceId={WORKSPACE_ID}
        workspaceSlug='acme'
        page={buildPage()}
        title='Manual'
        ancestors={[]}
        status='synced'
        presence={[]}
        userId='user-1'
        readOnly={false}
        fullWidth={false}
        onFullWidthChange={vi.fn()}
        fixedToolbar={false}
        onFixedToolbarChange={vi.fn()}
        panelToggle={{ open: false, onToggle }}
        onToggleNavigation={vi.fn()}
        getMarkdown={() => ''}
        onExport={vi.fn()}
      />,
    )
    await user.click(
      screen.getByRole('button', { name: 'Abrir painel lateral' }),
    )
    expect(onToggle).toHaveBeenCalled()
  })
})

describe('<WikiPageTopBar /> more menu', () => {
  async function openMenu(user: ReturnType<typeof renderBar>['user']) {
    await user.click(screen.getByRole('button', { name: 'Mais opções' }))
    return screen.findByRole('menu')
  }

  it('toggles full width and the fixed toolbar', async () => {
    const onFullWidthChange = vi.fn()
    const onFixedToolbarChange = vi.fn()
    const { user } = renderBar(buildPage(), {
      onFullWidthChange,
      onFixedToolbarChange,
    })

    await openMenu(user)
    await user.click(
      screen.getByRole('menuitemcheckbox', { name: 'Largura total' }),
    )
    expect(onFullWidthChange).toHaveBeenCalledWith(true)

    if (!screen.queryByRole('menu')) await openMenu(user)
    const toolbar = screen.getByRole('menuitemcheckbox', {
      name: 'Barra de ferramentas fixa',
    })
    expect(toolbar.getAttribute('aria-checked')).toBe('true')
    await user.click(toolbar)
    expect(onFixedToolbarChange).toHaveBeenCalledWith(false)
  })

  it('copies the page as markdown', async () => {
    const { user } = renderBar()

    await openMenu(user)
    await user.click(
      screen.getByRole('menuitem', { name: 'Copiar como Markdown' }),
    )

    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Markdown copiado'),
    )
    expect(await navigator.clipboard.readText()).toBe('# Manual')
  })

  it('says so when the editor is not ready for markdown', async () => {
    const { user } = renderBar(buildPage(), { getMarkdown: () => null })

    await openMenu(user)
    await user.click(
      screen.getByRole('menuitem', { name: 'Copiar como Markdown' }),
    )
    expect(notify.error).toHaveBeenCalledWith('O editor ainda está carregando')
  })

  it('duplicates the page and opens the copy', async () => {
    const { user, fetchSpy } = renderBar()

    await openMenu(user)
    await user.click(screen.getByRole('menuitem', { name: 'Fazer uma cópia' }))

    await waitFor(() => expect(push).toHaveBeenCalledWith('/acme/wiki/copy-1'))
    expect(getFetchCall(fetchSpy)).toMatchObject({
      url: `${PAGE_URL}/duplicate`,
      method: 'POST',
    })
  })

  it('exports through the submenu', async () => {
    const { user, onExport } = renderBar()

    await openMenu(user)
    await user.hover(screen.getByRole('menuitem', { name: 'Exportar' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'PDF' }))

    expect(onExport).toHaveBeenCalledWith('pdf')
  })

  it('archives after confirming and goes back to the wiki', async () => {
    const { user, fetchSpy } = renderBar()

    await openMenu(user)
    await user.click(screen.getByRole('menuitem', { name: 'Arquivar' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(fetchSpy).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Arquivar' }))

    await waitFor(() => expect(push).toHaveBeenCalledWith('/acme/wiki'))
    expect(getFetchCall(fetchSpy)).toMatchObject({
      url: `${PAGE_URL}/archive`,
      method: 'PATCH',
    })
  })

  it('does not archive when the confirmation is cancelled', async () => {
    const { user, fetchSpy } = renderBar()

    await openMenu(user)
    await user.click(screen.getByRole('menuitem', { name: 'Arquivar' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }))

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('repeats favorite, link and lock for phones', async () => {
    const { user, fetchSpy } = renderBar(buildPage({ canManageLock: true }))

    await openMenu(user)
    const items = screen
      .getAllByRole('menuitem')
      .map((item) => item.textContent)
    expect(items).toEqual(
      expect.arrayContaining([
        'Adicionar aos favoritos',
        'Copiar link',
        'Bloquear edição',
      ]),
    )
    await user.click(screen.getByRole('menuitem', { name: 'Bloquear edição' }))
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
    expect(getFetchCall(fetchSpy).url).toBe(`${PAGE_URL}/lock`)
  })
})
