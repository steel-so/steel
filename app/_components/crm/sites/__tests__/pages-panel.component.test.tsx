import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchBody, mockFetch } from '@/src/__tests__/component-utils'
import { moveAmongSiblings, PagesPanel } from '../pages-panel'
import { fakePage, fakeSite, PAGES, renderInEditor, SITE_ID } from './harness'

const notify = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}))
vi.mock('@/lib/notify', () => ({ notify }))

const BASE = `/crm/sites/${SITE_ID}`

function routes() {
  return mockFetch([
    { match: `${BASE}/pages`, data: PAGES },
    {
      method: 'POST',
      match: `${BASE}/pages/sobre/duplicate`,
      status: 201,
      data: {
        ...fakePage({ id: 'copia', title: 'Sobre (cópia)' }),
        document: {},
      },
    },
    {
      method: 'POST',
      match: `${BASE}/pages`,
      status: 201,
      data: { ...fakePage({ id: 'nova', title: 'Blog' }), document: {} },
    },
    { method: 'PATCH', match: `${BASE}/pages/reorder`, data: null },
    {
      method: 'PATCH',
      match: /\/pages\/[a-z]+$/,
      data: { ...fakePage({ id: 'sobre' }), document: {} },
    },
    { method: 'DELETE', match: `${BASE}/pages/contato`, data: null },
    {
      method: 'PATCH',
      match: new RegExp(`${BASE}$`),
      data: fakeSite({ homePageId: 'contato' }),
    },
  ])
}

function row(id: string) {
  return screen.getByTestId(`site-page-${id}`)
}

async function menu(id: string, item: string) {
  fireEvent.click(within(row(id)).getByRole('button', { name: /^Ações de/ }))
  fireEvent.click(await screen.findByRole('menuitem', { name: item }))
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('moveAmongSiblings', () => {
  it('moves within the same parent and stops at the edges', () => {
    expect(moveAmongSiblings(PAGES, 'sobre', 1)).toEqual([
      'home',
      'contato',
      'sobre',
    ])
    expect(moveAmongSiblings(PAGES, 'home', -1)).toBeNull()
    expect(moveAmongSiblings(PAGES, 'equipe', 1)).toBeNull()
    expect(moveAmongSiblings(PAGES, 'nope', 1)).toBeNull()
  })
})

describe('<PagesPanel />', () => {
  it('lists the tree in order, marks the home and the open page', () => {
    routes()
    renderInEditor(<PagesPanel />)
    const items = within(screen.getByRole('list', { name: 'Páginas do site' }))
      .getAllByRole('listitem')
      .map((item) => item.getAttribute('data-testid'))
    expect(items).toEqual([
      'site-page-home',
      'site-page-sobre',
      'site-page-equipe',
      'site-page-contato',
    ])
    expect(row('equipe').style.paddingLeft).toBe('14px')
    expect(within(row('home')).getByLabelText('Página inicial')).toBeTruthy()
    expect(
      row('home').querySelector('[aria-current="page"]')?.textContent,
    ).toBe('Início')
    expect(row('sobre').querySelector('[aria-current]')).toBeNull()
    expect(screen.getByText('4 páginas')).toBeTruthy()
  })

  it('saves the current document before opening another page', async () => {
    routes()
    const { ctx, save } = renderInEditor(<PagesPanel />)
    fireEvent.click(
      within(row('contato')).getByRole('button', { name: 'Contato' }),
    )
    await waitFor(() =>
      expect(ctx.open).toHaveBeenCalledWith({ kind: 'page', id: 'contato' }),
    )
    expect(save).toHaveBeenCalled()
  })

  it('does not switch when the save keeps failing', async () => {
    routes()
    const { ctx } = renderInEditor(
      <PagesPanel />,
      {},
      { save: async () => false },
    )
    fireEvent.click(
      within(row('contato')).getByRole('button', { name: 'Contato' }),
    )
    await waitFor(() => expect(notify.error).toHaveBeenCalled())
    expect(ctx.open).not.toHaveBeenCalled()
  })

  it('creates a page and opens it', async () => {
    const spy = routes()
    const { ctx } = renderInEditor(<PagesPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Nova página' }))
    fireEvent.change(screen.getByLabelText('Título da nova página'), {
      target: { value: 'Blog' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Criar página' }))
    await waitFor(() =>
      expect(ctx.open).toHaveBeenCalledWith({ kind: 'page', id: 'nova' }),
    )
    expect(fetchBody(spy, `${BASE}/pages`)).toEqual({
      title: 'Blog',
      parentId: null,
    })
  })

  it('adds a subpage under the chosen page', async () => {
    const spy = routes()
    renderInEditor(<PagesPanel />)
    await menu('sobre', 'Adicionar subpágina')
    const input = screen.getByLabelText('Título da nova página')
    expect(input.getAttribute('placeholder')).toBe('Subpágina de Sobre')
    fireEvent.change(input, { target: { value: 'Blog' } })
    fireEvent.submit(input.closest('form') as HTMLFormElement)
    await waitFor(() =>
      expect(fetchBody(spy, `${BASE}/pages`)).toEqual({
        title: 'Blog',
        parentId: 'sobre',
      }),
    )
  })

  it('renames inline on double click', async () => {
    const spy = routes()
    renderInEditor(<PagesPanel />)
    fireEvent.doubleClick(
      within(row('sobre')).getByRole('button', { name: 'Sobre' }),
    )
    const input = screen.getByLabelText('Novo título')
    fireEvent.change(input, { target: { value: 'Quem somos' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() =>
      expect(fetchBody(spy, `${BASE}/pages/sobre`, 'PATCH')).toEqual({
        title: 'Quem somos',
      }),
    )
  })

  it('sets the home page, duplicates and reorders from the menu', async () => {
    const spy = routes()
    const { ctx } = renderInEditor(<PagesPanel />)

    await menu('contato', 'Definir como inicial')
    await waitFor(() => expect(ctx.setSite).toHaveBeenCalled())
    expect(fetchBody(spy, new RegExp(`${BASE}$`), 'PATCH')).toEqual({
      homePageId: 'contato',
    })

    await menu('sobre', 'Duplicar')
    await waitFor(() =>
      expect(ctx.open).toHaveBeenCalledWith({ kind: 'page', id: 'copia' }),
    )

    await menu('sobre', 'Mover para baixo')
    await waitFor(() =>
      expect(fetchBody(spy, `${BASE}/pages/reorder`, 'PATCH')).toEqual({
        orderedIds: ['home', 'contato', 'sobre'],
      }),
    )
  })

  it('deletes a page after confirming, never the home page', async () => {
    const spy = routes()
    renderInEditor(<PagesPanel />)
    fireEvent.click(
      within(row('home')).getByRole('button', { name: /^Ações de/ }),
    )
    expect(screen.queryByRole('menuitem', { name: 'Excluir' })).toBeNull()
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: 'Escape',
    })

    await menu('contato', 'Excluir')
    fireEvent.click(
      await screen.findByRole('button', { name: 'Excluir página' }),
    )
    await waitFor(() =>
      expect(
        spy.mock.calls.some(
          ([url, init]) =>
            String(url).includes(`${BASE}/pages/contato`) &&
            init?.method === 'DELETE',
        ),
      ).toBe(true),
    )
    expect(notify.success).toHaveBeenCalledWith('Página “Contato” excluída.')
  })

  it('edits title, address and SEO in the page settings', async () => {
    const spy = routes()
    renderInEditor(<PagesPanel />)
    await menu('sobre', 'Configurações e SEO')
    const dialog = await screen.findByTestId('page-settings')
    fireEvent.change(within(dialog).getByLabelText('Endereço'), {
      target: { value: 'Quem-Somos' },
    })
    fireEvent.change(within(dialog).getByLabelText('Descrição'), {
      target: { value: 'Conheça a clínica.' },
    })
    fireEvent.click(
      within(dialog).getByRole('switch', {
        name: /Esconder dos buscadores e do menu/,
      }),
    )
    // The Google preview follows the fields.
    expect(
      within(dialog).getByText('https://clinica.sites.example.com/quem-somos'),
    ).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }))
    await waitFor(() =>
      expect(fetchBody(spy, `${BASE}/pages/sobre`, 'PATCH')).toEqual({
        title: 'Sobre',
        slug: 'quem-somos',
        seo: { description: 'Conheça a clínica.', noindex: true },
      }),
    )
  })

  it('hides editing actions from read-only profiles', () => {
    routes()
    renderInEditor(<PagesPanel />, { canEdit: false })
    expect(screen.queryByRole('button', { name: 'Nova página' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Ações de/ })).toBeNull()
  })
})
