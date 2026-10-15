import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CanvasEditor } from '@/app/_components/canvas/canvas-editor'
import { getNode } from '@/src/lib/canvas/nodes'
import type { CustomControlProps } from '@/src/lib/canvas/registry'
import { createCanvasStore } from '@/src/lib/canvas/store'
import type { CanvasDocument, CanvasNode } from '@/src/lib/canvas/types'
import { createEmailRenderContext } from '@/src/lib/canvas-email/theme'
import { createEditorEmailCatalog, PRODUCT_BLOCK } from '../editor-catalog'
import {
  type EmailEditorData,
  EmailEditorDataProvider,
  formatProductPrice,
  toProductData,
} from '../editor-data'
import { ProductPickerControl } from '../product-picker-control'
import { createTemplateMetaStore } from '../template-meta'
import { newsletterDocument, product, WS } from './editor-fixtures'

vi.mock('@/lib/notify', async () => ({
  notify: (await import('./editor-fixtures')).notify,
}))
vi.mock('@/app/_components/canvas/inspector/controls/richtext', () => ({
  RichTextControl: () => null,
}))

const PRODUCTS = [
  product(),
  product({
    id: 'p2',
    name: 'Roteador Wi-Fi 6',
    sku: 'RT-6',
    description: 'Cobertura para a casa toda',
    unitPrice: 499,
  }),
  product({ id: 'p3', name: 'Plano antigo', active: false }),
]

function data(overrides: Partial<EmailEditorData> = {}): EmailEditorData {
  return {
    workspaceId: WS,
    slug: 'acme',
    templateId: 't1',
    products: PRODUCTS,
    productsLoading: false,
    brand: {
      companyName: 'Acme',
      logoUrl: '',
      primaryColor: '#0F766E',
      address: '',
      website: '',
    },
    meta: createTemplateMetaStore({ name: 'N', subject: 'S' }),
    flushMeta: async () => true,
    ...overrides,
  }
}

const NODE: CanvasNode = { id: 'n1', type: PRODUCT_BLOCK, props: {} }

function renderPicker(
  value: unknown,
  overrides: Partial<EmailEditorData> = {},
) {
  const onChange = vi.fn<CustomControlProps['onChange']>()
  render(
    <EmailEditorDataProvider value={data(overrides)}>
      <ProductPickerControl
        value={value}
        onChange={onChange}
        node={NODE}
        breakpoint='base'
      />
    </EmailEditorDataProvider>,
  )
  return onChange
}

describe('<ProductPickerControl />', () => {
  it('shows the chosen product with its price', () => {
    renderPicker('p2')
    const trigger = screen.getByTestId('product-picker-trigger')
    expect(trigger.textContent).toContain('Roteador Wi-Fi 6')
    expect(trigger.textContent).toContain(formatProductPrice(PRODUCTS[1]))
  })

  it('searches active products by name or SKU, without accents', () => {
    const onChange = renderPicker(null)
    expect(screen.getByTestId('product-picker-trigger').textContent).toContain(
      'Escolher um produto',
    )
    fireEvent.click(screen.getByTestId('product-picker-trigger'))
    const list = screen.getByRole('listbox', { name: 'Produtos do CRM' })
    expect(within(list).getAllByRole('option')).toHaveLength(2)
    expect(within(list).queryByText('Plano antigo')).toBeNull()

    fireEvent.change(screen.getByLabelText('Buscar produto'), {
      target: { value: 'rt-6' },
    })
    expect(within(list).getAllByRole('option')).toHaveLength(1)
    fireEvent.change(screen.getByLabelText('Buscar produto'), {
      target: { value: 'ROTEADOR wi-fi' },
    })
    fireEvent.click(within(list).getByText('Roteador Wi-Fi 6'))
    expect(onChange).toHaveBeenCalledWith('p2')
  })

  it('clears the product', () => {
    const onChange = renderPicker('p1')
    fireEvent.click(screen.getByRole('button', { name: 'Remover produto' }))
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('handles a product removed from the CRM and an empty catalog', () => {
    renderPicker('gone', { products: [] })
    expect(screen.getByTestId('product-picker-trigger').textContent).toContain(
      'Produto removido do CRM',
    )
    fireEvent.click(screen.getByTestId('product-picker-trigger'))
    expect(screen.getByText('Nenhum produto cadastrado no CRM.')).toBeTruthy()
    expect(
      screen.getByText('Cadastrar produtos').closest('a')?.getAttribute('href'),
    ).toBe('/acme/crm/products')
  })

  it('says when the search finds nothing and while loading', () => {
    renderPicker(null)
    fireEvent.click(screen.getByTestId('product-picker-trigger'))
    fireEvent.change(screen.getByLabelText('Buscar produto'), {
      target: { value: 'xyz' },
    })
    expect(screen.getByText('Nenhum produto encontrado.')).toBeTruthy()
  })

  it('shows the loading state', () => {
    renderPicker(null, { products: [], productsLoading: true })
    fireEvent.click(screen.getByTestId('product-picker-trigger'))
    expect(screen.getByText('Carregando produtos…')).toBeTruthy()
  })
})

/** The editor's catalog over a store the test controls. */
function mountEditor(doc: CanvasDocument) {
  const products = toProductData(PRODUCTS)
  const holder: { store?: ReturnType<typeof createCanvasStore> } = {}
  const catalog = createEditorEmailCatalog({
    allowHtml: true,
    productPicker: ProductPickerControl,
    context: () =>
      createEmailRenderContext({
        products,
        doc: () => holder.store?.getState().doc ?? doc,
      }),
  })
  const store = createCanvasStore(catalog, doc)
  holder.store = store
  render(
    <EmailEditorDataProvider value={data()}>
      <CanvasEditor
        catalog={catalog}
        store={store}
        initialDocument={doc}
        viewportWidths={{ base: 680, mobile: 375 }}
        title='E-mail'
        onSave={async () => true}
      />
    </EmailEditorDataProvider>,
  )
  return store
}

async function frameDoc(): Promise<Document> {
  const frame = screen.getByTestId('canvas-frame') as HTMLIFrameElement
  await waitFor(() =>
    expect(
      frame.contentDocument?.querySelector('[data-canvas-id]'),
    ).toBeTruthy(),
  )
  return frame.contentDocument as Document
}

describe('e-mail catalog in the editor', () => {
  it('uses the CRM product picker in the product inspector', async () => {
    const doc = newsletterDocument()
    const column = Object.values(doc.nodes).find(
      (node) => node.type === 'email.column',
    ) as CanvasNode
    doc.nodes.prod = {
      id: 'prod',
      type: PRODUCT_BLOCK,
      props: {
        ...(createEditorEmailCatalog({
          allowHtml: true,
          productPicker: ProductPickerControl,
          context: () => createEmailRenderContext(),
        }).components[PRODUCT_BLOCK].defaultProps() as object),
      },
    }
    column.children = [...(column.children ?? []), 'prod']
    const store = mountEditor(doc)
    act(() => store.select('prod'))
    fireEvent.click(await screen.findByTestId('product-picker-trigger'))
    fireEvent.click(screen.getByText('Plano Fibra 500'))
    expect(getNode(store.getState().doc, 'prod')?.props.productId).toBe('p1')
    // The block shows the CRM data right away.
    const frame = await frameDoc()
    await waitFor(() =>
      expect(
        frame.querySelector('[data-canvas-id="prod"]')?.textContent,
      ).toContain('Plano Fibra 500'),
    )
  })

  it('redraws sibling columns when one column width changes', async () => {
    const doc = newsletterDocument()
    const section = Object.values(doc.nodes).find(
      (node) => node.type === 'email.section',
    ) as CanvasNode
    const first = section.children?.[0] as string
    const template = doc.nodes[first]
    for (const id of ['c2', 'c3']) {
      doc.nodes[id] = { ...template, id, children: [] }
    }
    section.children = [first, 'c2', 'c3']
    const store = mountEditor(doc)
    const frame = await frameDoc()
    const width = (id: string) =>
      frame.querySelector(`[data-canvas-id="${id}"]`)?.getAttribute('width')
    await waitFor(() => expect(width('c2')).toMatch(/^33\.3/))

    act(() => {
      store.dispatch({ kind: 'update', id: first, set: { width: 50 } })
    })
    // The siblings follow immediately — no section-level change needed.
    await waitFor(() => {
      expect(width(first)).toBe('50%')
      expect(width('c2')).toBe('25%')
      expect(width('c3')).toBe('25%')
    })

    // And the body font reaches every block at once.
    act(() => {
      store.dispatch({
        kind: 'update',
        id: doc.rootId,
        set: { fontFamily: 'georgia' },
      })
    })
    const heading = Object.values(doc.nodes).find(
      (node) => node.type === 'email.heading',
    ) as CanvasNode
    await waitFor(() =>
      expect(
        frame.querySelector(`[data-canvas-id="${heading.id}"]`)?.outerHTML,
      ).toContain('Georgia'),
    )
  })
})
