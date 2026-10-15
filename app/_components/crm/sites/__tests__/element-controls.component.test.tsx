import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CanvasStoreProvider } from '@/app/_components/canvas/use-canvas'
import { getNode } from '@/src/lib/canvas/ops'
import { createCanvasStore } from '@/src/lib/canvas/store'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import { siteCatalog } from '@/src/lib/canvas-site/catalog'
import { SITE_TYPES } from '@/src/lib/canvas-site/constants'
import {
  heading,
  section,
  spec,
  text,
  toDocument,
} from '@/src/lib/canvas-site/presets/builder'
import {
  anchorTargets,
  SiteAnchorPicker,
  SiteChildAdder,
  SiteWhatsappPicker,
} from '../element-controls'
import { renderInEditor } from './harness'

const connections = vi.hoisted(() => ({
  data: undefined as unknown,
}))

vi.mock('@/src/hooks/use-whatsapp-connections', () => ({
  useWhatsAppConnections: () => ({ data: connections.data }),
}))

function sampleDoc(): CanvasDocument {
  return toDocument([
    section({ anchor: 'contato' }, [
      text('Abrir', { interaction: { action: 'popup', target: 'oferta' } }),
      spec(SITE_TYPES.carousel, {}, [spec(SITE_TYPES.slide, {}, [])]),
      spec(SITE_TYPES.tabs, {}, [spec(SITE_TYPES.tab, {}, [])]),
      spec(SITE_TYPES.accordion, {}, [
        spec(SITE_TYPES.accordionItem, {}, []),
        spec(SITE_TYPES.accordionItem, {}, []),
      ]),
      spec(SITE_TYPES.whatsapp, { phone: '' }),
    ]),
    spec(SITE_TYPES.popup, { anchor: 'oferta', name: 'Oferta' }, [
      heading('h2', 'Oi'),
    ]),
    spec(SITE_TYPES.popup, { name: '' }, []),
  ])
}

function setup(make: (doc: CanvasDocument) => React.ReactElement) {
  const doc = sampleDoc()
  const store = createCanvasStore(siteCatalog, doc)
  const rendered = renderInEditor(
    <CanvasStoreProvider store={store}>{make(doc)}</CanvasStoreProvider>,
  )
  return { ...rendered, store, doc }
}

const ofType = (doc: CanvasDocument, type: string) =>
  Object.values(doc.nodes).filter((node) => node.type === type)

describe('SiteChildAdder', () => {
  it('adds a slide, a tab or an item and selects it', () => {
    const { store, doc } = setup((d) => (
      <>
        <SiteChildAdder
          value={undefined}
          onChange={vi.fn()}
          node={ofType(d, SITE_TYPES.carousel)[0]}
          breakpoint='base'
        />
        <SiteChildAdder
          value={undefined}
          onChange={vi.fn()}
          node={ofType(d, SITE_TYPES.accordion)[0]}
          breakpoint='base'
        />
        <SiteChildAdder
          value={undefined}
          onChange={vi.fn()}
          node={ofType(d, SITE_TYPES.tabs)[0]}
          breakpoint='base'
        />
        <SiteChildAdder
          value={undefined}
          onChange={vi.fn()}
          node={ofType(d, SITE_TYPES.text)[0]}
          breakpoint='base'
        />
      </>
    ))
    expect(screen.getByText(/1 slide ·/)).toBeTruthy()
    expect(screen.getByText(/2 itens ·/)).toBeTruthy()
    expect(screen.getByText(/1 aba ·/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Adicionar slide/ }))
    const carousel = ofType(doc, SITE_TYPES.carousel)[0].id
    const children = getNode(store.getState().doc, carousel)?.children ?? []
    expect(children).toHaveLength(2)
    expect(store.getState().selection).toEqual([children[1]])
    expect(screen.getByText(/2 slides ·/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Adicionar aba/ }))
    expect(screen.getByText(/2 abas ·/)).toBeTruthy()
    expect(screen.getAllByRole('button')).toHaveLength(3)
  })
})

describe('anchor targets', () => {
  it('lists popups (with generated ids) and anchored elements', () => {
    const doc = sampleDoc()
    const targets = anchorTargets(doc, { [SITE_TYPES.section]: 'Seção' })
    const unnamed = ofType(doc, SITE_TYPES.popup)[1]
    expect(targets).toEqual([
      { anchor: 'oferta', label: 'Popup: Oferta', popup: true },
      {
        anchor: `popup-${unnamed.id}`,
        label: 'Popup: site.popup',
        popup: true,
      },
      { anchor: 'contato', label: 'Seção', popup: false },
    ])
  })

  it('picks a popup for "Abrir popup" and any anchor otherwise', async () => {
    const onChange = vi.fn()
    const { doc } = setup((d) => (
      <SiteAnchorPicker
        value='oferta'
        onChange={onChange}
        node={ofType(d, SITE_TYPES.text)[0]}
        breakpoint='base'
      />
    ))
    expect(doc).toBeDefined()
    const trigger = screen.getByRole('combobox', { name: 'Destino' })
    expect(trigger.textContent).toContain('Popup: Oferta (#oferta)')
    fireEvent.click(trigger)
    const options = await screen.findAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual([
      'Nenhum',
      'Popup: Oferta (#oferta)',
      expect.stringMatching(/^Popup: Popup \(#popup-/),
    ])
    fireEvent.pointerDown(options[0], { pointerType: 'mouse' })
    fireEvent.click(options[0])
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(undefined))
  })

  it('explains how to create a target when there is none', () => {
    const store = createCanvasStore(siteCatalog, toDocument([section({}, [])]))
    renderInEditor(
      <CanvasStoreProvider store={store}>
        <SiteAnchorPicker
          value='sumiu'
          onChange={vi.fn()}
          node={{
            id: 'x',
            type: SITE_TYPES.text,
            props: { interaction: { action: 'scroll' } },
          }}
          breakpoint='base'
        />
        <SiteAnchorPicker
          value=''
          onChange={vi.fn()}
          node={{
            id: 'y',
            type: SITE_TYPES.text,
            props: { interaction: { action: 'popup' } },
          }}
          breakpoint='base'
        />
      </CanvasStoreProvider>,
    )
    expect(
      screen.getByText(/#sumiu \(não encontrado nesta página\)/),
    ).toBeTruthy()
    expect(screen.getByText(/Escolha o destino/)).toBeTruthy()
    expect(screen.getByText(/Nenhum elemento com âncora/)).toBeTruthy()
    expect(screen.getByText(/Nenhum popup nesta página/)).toBeTruthy()
  })
})

describe('SiteWhatsappPicker', () => {
  const pick = (d: CanvasDocument, onChange = vi.fn(), value = '') => (
    <SiteWhatsappPicker
      value={value}
      onChange={onChange}
      node={ofType(d, SITE_TYPES.whatsapp)[0]}
      breakpoint='base'
    />
  )

  it('types a number when the workspace has no connection', () => {
    connections.data = undefined
    const onChange = vi.fn()
    setup((d) => pick(d, onChange))
    expect(screen.queryByRole('combobox')).toBeNull()
    fireEvent.change(screen.getByLabelText('Número do WhatsApp'), {
      target: { value: '+55 (11) 9abc1234' },
    })
    expect(onChange).toHaveBeenCalledWith('+55 (11) 91234')
  })

  it('fills the number from a Comunicação connection', async () => {
    connections.data = [
      { id: 'c1', label: 'Comercial', phoneNumber: '+5511999990000' },
    ]
    const { store, doc } = setup((d) => pick(d))
    const id = ofType(doc, SITE_TYPES.whatsapp)[0].id
    fireEvent.click(
      screen.getByRole('combobox', { name: 'Conexão do WhatsApp' }),
    )
    const option = await screen.findByRole('option', { name: /Comercial/ })
    // Base UI commits a mouse selection that started on the item itself.
    fireEvent.pointerDown(option, { pointerType: 'mouse' })
    fireEvent.click(option)
    await waitFor(() =>
      expect(getNode(store.getState().doc, id)?.props).toMatchObject({
        connectionId: 'c1',
        phone: '+5511999990000',
      }),
    )
    fireEvent.click(
      screen.getByRole('combobox', { name: 'Conexão do WhatsApp' }),
    )
    const typed = await screen.findByRole('option', { name: 'Número digitado' })
    fireEvent.pointerDown(typed, { pointerType: 'mouse' })
    fireEvent.click(typed)
    await waitFor(() =>
      expect(
        getNode(store.getState().doc, id)?.props.connectionId,
      ).toBeUndefined(),
    )
  })

  it('drops the connection when the number is typed', () => {
    connections.data = [
      { id: 'c1', label: 'Comercial', phoneNumber: '+5511999990000' },
    ]
    const doc = sampleDoc()
    const node = ofType(doc, SITE_TYPES.whatsapp)[0]
    doc.nodes[node.id] = {
      ...node,
      props: { ...node.props, connectionId: 'c1', phone: '+5511999990000' },
    }
    const store = createCanvasStore(siteCatalog, doc)
    const onChange = vi.fn()
    renderInEditor(
      <CanvasStoreProvider store={store}>
        <SiteWhatsappPicker
          value='+5511999990000'
          onChange={onChange}
          node={getNode(store.getState().doc, node.id) as never}
          breakpoint='base'
        />
      </CanvasStoreProvider>,
    )
    expect(
      screen.getByRole('combobox', { name: 'Conexão do WhatsApp' }).textContent,
    ).toContain('Comercial')
    fireEvent.change(screen.getByLabelText('Número do WhatsApp'), {
      target: { value: '+55 11 3333-0000' },
    })
    expect(onChange).not.toHaveBeenCalled()
    const props = getNode(store.getState().doc, node.id)?.props
    expect(props?.phone).toBe('+55 11 3333-0000')
    expect(props?.connectionId).toBeUndefined()
  })
})
