import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useCanvasEditor } from '@/app/_components/canvas/editor-context'
import { CanvasStoreProvider } from '@/app/_components/canvas/use-canvas'
import {
  fetchBody,
  mockFetch,
  renderWithQuery,
} from '@/src/__tests__/component-utils'
import { createSiteDocument } from '@/src/__tests__/factories/site.factory'
import { getNode } from '@/src/lib/canvas/ops'
import type { CanvasNode } from '@/src/lib/canvas/types'
import { SITE_SYMBOL_TYPE } from '@/src/lib/canvas-site'
import type { SiteGlobalDTO } from '@/types/site'
import type { SiteRedirectDTO } from '@/types/site-platform'
import { RedirectsDialog } from '../redirects-dialog'
import { SymbolOverridesControl } from '../symbol-overrides-control'
import { SymbolsPanel } from '../symbols-panel'
import { renderInEditor, SITE_ID, WS } from './harness'

/** The panel reads the live document: provide the harness store. */
function Panel() {
  const { store } = useCanvasEditor()
  return (
    <CanvasStoreProvider store={store}>
      <SymbolsPanel />
    </CanvasStoreProvider>
  )
}

const notify = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}))
vi.mock('@/lib/notify', () => ({ notify }))

const BASE = `/api/workspaces/${WS}/crm/sites/${SITE_ID}`

function redirect(overrides: Partial<SiteRedirectDTO> = {}): SiteRedirectDTO {
  return {
    id: 'r1',
    siteId: SITE_ID,
    fromPath: '/antigo',
    toPath: '/novo',
    permanent: true,
    createdAt: '2026-10-15T00:00:00.000Z',
    updatedAt: '2026-10-15T00:00:00.000Z',
    ...overrides,
  }
}

function symbol(overrides: Partial<SiteGlobalDTO> = {}): SiteGlobalDTO {
  return {
    id: 'sym1',
    siteId: SITE_ID,
    kind: 'SYMBOL',
    name: 'Chamada',
    document: createSiteDocument('Fale com a gente'),
    createdAt: '2026-10-15T00:00:00.000Z',
    updatedAt: '2026-10-15T00:00:00.000Z',
    ...overrides,
  }
}

beforeEach(() => vi.clearAllMocks())

describe('<RedirectsDialog />', () => {
  function setup(canEdit = true, list = [redirect()]) {
    const spy = mockFetch([
      { match: `${BASE}/redirects`, data: list },
      {
        method: 'POST',
        match: `${BASE}/redirects`,
        status: 201,
        data: redirect({ id: 'r2', fromPath: '/blog/*' }),
      },
      {
        method: 'PATCH',
        match: `${BASE}/redirects/r1`,
        data: redirect({ toPath: '/outro' }),
      },
      { method: 'DELETE', match: `${BASE}/redirects/r1`, data: null },
    ])
    renderWithQuery(
      <RedirectsDialog
        open
        onOpenChange={() => {}}
        workspaceId={WS}
        siteId={SITE_ID}
        canEdit={canEdit}
      />,
    )
    return spy
  }

  it('lists, creates, edits and deletes redirects', async () => {
    const spy = setup()
    expect(await screen.findByText('/antigo')).toBeTruthy()
    expect(screen.getByText('Permanente', { selector: 'span' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }))
    expect(notify.error).toHaveBeenCalledWith(
      'Informe o endereço antigo e o novo.',
    )
    fireEvent.change(screen.getByLabelText('Endereço antigo'), {
      target: { value: '/blog/*' },
    })
    fireEvent.change(screen.getByLabelText('Novo endereço'), {
      target: { value: '/novidades/*' },
    })
    fireEvent.click(screen.getByRole('switch'))
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }))
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Redirecionamento criado.'),
    )
    expect(fetchBody(spy, `${BASE}/redirects`)).toEqual({
      fromPath: '/blog/*',
      toPath: '/novidades/*',
      permanent: false,
    })

    fireEvent.click(screen.getByRole('button', { name: 'Editar /antigo' }))
    expect(
      (screen.getByLabelText('Endereço antigo') as HTMLInputElement).value,
    ).toBe('/antigo')
    fireEvent.change(screen.getByLabelText('Novo endereço'), {
      target: { value: '/outro' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Redirecionamento salvo.'),
    )
    expect(fetchBody(spy, `${BASE}/redirects/r1`, 'PATCH')).toMatchObject({
      toPath: '/outro',
    })

    fireEvent.click(screen.getByRole('button', { name: 'Editar /antigo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Excluir /antigo' }))
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Redirecionamento excluído.'),
    )
  })

  it('reports server errors and hides editing from viewers', async () => {
    mockFetch([
      { match: `${BASE}/redirects`, data: [] },
      {
        method: 'POST',
        match: `${BASE}/redirects`,
        status: 422,
        error: 'Este redirecionamento leva de volta ao endereço de origem',
      },
    ])
    renderWithQuery(
      <RedirectsDialog
        open
        onOpenChange={() => {}}
        workspaceId={WS}
        siteId={SITE_ID}
        canEdit
      />,
    )
    expect(
      await screen.findByText('Nenhum redirecionamento ainda.'),
    ).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Endereço antigo'), {
      target: { value: '/a' },
    })
    fireEvent.change(screen.getByLabelText('Novo endereço'), {
      target: { value: '/a' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }))
    await waitFor(() => expect(notify.error).toHaveBeenCalled())
  })

  it('is read-only without edit permission', async () => {
    setup(false)
    expect(await screen.findByText('/antigo')).toBeTruthy()
    expect(screen.queryByLabelText('Endereço antigo')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Excluir /antigo' })).toBeNull()
  })
})

describe('<SymbolsPanel />', () => {
  it('turns the selected section into a component and its first copy', async () => {
    const created = symbol({ id: 'sym9', name: 'Contato' })
    const spy = mockFetch([
      {
        method: 'POST',
        match: `${BASE}/globals`,
        status: 201,
        data: created,
      },
    ])
    const { ctx, editor } = renderInEditor(<Panel />)
    expect(screen.getByText(/Selecione uma seção da página/)).toBeTruthy()
    act(() => editor.store.select('s1'))
    fireEvent.change(screen.getByLabelText('Nome do componente'), {
      target: { value: 'Contato' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Criar componente' }))
    await waitFor(() => expect(ctx.setGlobals).toHaveBeenCalledWith([created]))
    const body = fetchBody(spy, `${BASE}/globals`) as {
      kind: string
      document: { nodes: Record<string, CanvasNode> }
    }
    expect(body.kind).toBe('SYMBOL')
    expect(
      Object.values(body.document.nodes).some(
        (node) => node.props.anchor === 'inicio',
      ),
    ).toBe(true)
    const doc = editor.store.getState().doc
    const children = getNode(doc, doc.rootId)?.children ?? []
    expect(children).toHaveLength(1)
    expect(getNode(doc, children[0])).toMatchObject({
      type: SITE_SYMBOL_TYPE,
      props: { symbolId: 'sym9' },
    })
    expect(getNode(doc, 's1')).toBeUndefined()
  })

  it('lists components to insert, edit, rename and delete', async () => {
    const spy = mockFetch([
      {
        method: 'PATCH',
        match: `${BASE}/globals/sym1`,
        data: symbol({ name: 'Novo nome' }),
      },
      { method: 'DELETE', match: `${BASE}/globals/sym1`, data: null },
    ])
    const { ctx, editor, save } = renderInEditor(<Panel />, {
      globals: [symbol()],
    })
    fireEvent.click(screen.getByTestId('preset-symbol-sym1'))
    const doc = editor.store.getState().doc
    expect(
      Object.values(doc.nodes).some((node) => node.type === SITE_SYMBOL_TYPE),
    ).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
    await waitFor(() =>
      expect(ctx.open).toHaveBeenCalledWith({ kind: 'global', id: 'sym1' }),
    )
    expect(save).toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Renomear' }))
    const input = screen.getByLabelText('Novo nome do componente')
    fireEvent.change(input, { target: { value: 'Novo nome' } })
    fireEvent.submit(input.closest('form') as HTMLFormElement)
    await waitFor(() => expect(ctx.setGlobals).toHaveBeenCalled())
    expect(fetchBody(spy, `${BASE}/globals/sym1`, 'PATCH')).toEqual({
      name: 'Novo nome',
    })

    fireEvent.click(screen.getByRole('button', { name: 'Excluir Chamada' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Excluir' }))
    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith('Componente excluído.'),
    )
  })

  it('shows the editing banner on a master and leaves back to the page', async () => {
    const { ctx } = renderInEditor(<Panel />, {
      globals: [symbol()],
      target: { kind: 'global', id: 'sym1' },
    })
    expect(screen.getByText(/Você está editando “Chamada”/)).toBeTruthy()
    expect(screen.queryByTestId('preset-symbol-sym1')).toBeNull()
    fireEvent.click(
      screen.getByRole('button', { name: /Voltar para a página/ }),
    )
    await waitFor(() =>
      expect(ctx.open).toHaveBeenCalledWith({ kind: 'page', id: 'home' }),
    )
  })
})

describe('<SymbolOverridesControl />', () => {
  const master = symbol()
  const headingId = 'h1'
  const instance: CanvasNode = {
    id: 'i1',
    type: SITE_SYMBOL_TYPE,
    props: { symbolId: 'sym1', overrides: {} },
  }

  it('overrides and restores the texts of one copy', async () => {
    const onChange = vi.fn()
    const { ctx } = renderInEditor(
      <SymbolOverridesControl
        value={{ [headingId]: 'Antigo' }}
        onChange={onChange}
        node={instance}
        breakpoint='base'
      />,
      { globals: [master] },
    )
    const field = screen.getByLabelText('Título 1') as HTMLTextAreaElement
    expect(field.value).toBe('Antigo')
    expect(field.placeholder).toBe('Fale com a gente')
    fireEvent.change(field, { target: { value: 'Ligue já' } })
    expect(onChange).toHaveBeenLastCalledWith({ [headingId]: 'Ligue já' })
    fireEvent.click(
      screen.getByRole('button', { name: 'Usar o do componente' }),
    )
    expect(onChange).toHaveBeenLastCalledWith({})

    fireEvent.click(screen.getByRole('button', { name: /Editar componente/ }))
    await waitFor(() =>
      expect(ctx.open).toHaveBeenCalledWith({ kind: 'global', id: 'sym1' }),
    )
  })

  it('stores rich texts as paragraphs', () => {
    const doc = createSiteDocument()
    const withText = {
      ...doc,
      nodes: {
        ...doc.nodes,
        s1: { ...doc.nodes.s1, children: ['t1'] },
        t1: {
          id: 't1',
          type: 'site.text',
          props: { html: '<p>Mestre</p>', preset: 'body', align: 'left' },
        },
      },
    }
    const onChange = vi.fn()
    renderInEditor(
      <SymbolOverridesControl
        value={undefined}
        onChange={onChange}
        node={instance}
        breakpoint='base'
      />,
      { globals: [symbol({ document: withText })] },
    )
    fireEvent.change(screen.getByLabelText('Texto 1'), {
      target: { value: 'Linha 1\nLinha 2' },
    })
    expect(onChange).toHaveBeenLastCalledWith({
      t1: '<p>Linha 1</p><p>Linha 2</p>',
    })
  })

  it('explains a deleted component or one without texts', () => {
    const { unmount } = renderInEditor(
      <SymbolOverridesControl
        value={{}}
        onChange={() => {}}
        node={instance}
        breakpoint='base'
      />,
    )
    expect(screen.getByText(/foi excluído/)).toBeTruthy()
    unmount()
    const doc = createSiteDocument()
    renderInEditor(
      <SymbolOverridesControl
        value={{}}
        onChange={() => {}}
        node={instance}
        breakpoint='base'
      />,
      {
        globals: [
          symbol({
            document: {
              ...doc,
              nodes: { root: { ...doc.nodes.root, children: [] } },
            },
          }),
        ],
      },
    )
    expect(screen.getByText(/não tem textos para personalizar/)).toBeTruthy()
  })
})
