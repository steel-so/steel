import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { getNode } from '@/src/lib/canvas/ops'
import type { CanvasStore } from '@/src/lib/canvas/store'
import {
  DEMO_TOKENS,
  demoCatalog,
  demoDocument,
} from '../__demo__/demo-catalog'
import { CanvasEditor } from '../canvas-editor'

// jsdom has no layout: ProseMirror measures ranges when it scrolls.
Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect ??= () => new DOMRect()

vi.mock('@/lib/notify', () => ({
  notify: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

let store: CanvasStore

function setup() {
  render(
    <CanvasEditor
      catalog={demoCatalog}
      initialDocument={demoDocument()}
      viewportWidths={{ base: 1200, tablet: 768, mobile: 375 }}
      colorTokens={DEMO_TOKENS}
      title='Teste'
      actions={(ctx) => {
        store = ctx.store
        return null
      }}
      onSave={async () => true}
    />,
  )
}

const node = (id: string) => getNode(store.getState().doc, id)

async function frameDoc(): Promise<Document> {
  const frame = screen.getByTestId('canvas-frame') as HTMLIFrameElement
  await waitFor(() =>
    expect(
      frame.contentDocument?.querySelector('[data-canvas-id="hero-title"]'),
    ).toBeTruthy(),
  )
  const doc = frame.contentDocument as Document
  // jsdom has no layout: ProseMirror measures ranges when it scrolls.
  const range = (doc.defaultView as unknown as { Range: typeof Range }).Range
  range.prototype.getClientRects ??= () => [] as unknown as DOMRectList
  range.prototype.getBoundingClientRect ??= () => new DOMRect()
  return doc
}

const overlay = () => screen.getByTestId('canvas-overlay')

const el = (doc: Document, id: string) =>
  doc.querySelector(`[data-canvas-id="${id}"]`) as HTMLElement

describe('canvas frame gestures', () => {
  it('selects, multi-selects and hovers inside the iframe', async () => {
    setup()
    const doc = await frameDoc()
    fireEvent.click(el(doc, 'hero-text'))
    expect(store.getState().selection).toEqual(['hero-text'])
    fireEvent.click(el(doc, 'hero-title'), { shiftKey: true })
    expect(store.getState().selection).toEqual(['hero-text', 'hero-title'])
    fireEvent.click(el(doc, 'hero-title'), { shiftKey: true })
    expect(store.getState().selection).toEqual(['hero-text'])
    fireEvent.pointerMove(el(doc, 'hero-cta'))
    expect(store.getState().hovered).toBe('hero-cta')
    fireEvent.pointerLeave(doc)
    expect(store.getState().hovered).toBeNull()
    fireEvent.click(el(doc, 'root'))
    expect(store.getState().selection).toEqual([])
  })

  it('passes clicks on locked nodes to the parent and blocks link navigation', async () => {
    setup()
    const doc = await frameDoc()
    act(() => {
      store.dispatch({ kind: 'meta', id: 'hero-cta', set: { locked: true } })
    })
    const link = el(doc, 'hero-cta').querySelector('a') as HTMLAnchorElement
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    link.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(store.getState().selection).toEqual(['hero-left'])
  })

  it('shows the selection box with quick actions', async () => {
    setup()
    const doc = await frameDoc()
    fireEvent.click(el(doc, 'hero-text'))
    const box = await screen.findByTestId('canvas-selection')
    expect(box.dataset.nodeId).toBe('hero-text')
    fireEvent.click(within(overlay()).getByRole('button', { name: 'Duplicar' }))
    expect(node('hero-left')?.children).toHaveLength(4)
    act(() => store.select('hero-text'))
    fireEvent.click(
      screen.getByRole('button', { name: 'Selecionar o elemento pai' }),
    )
    expect(store.getState().selection).toEqual(['hero-left'])
    act(() => store.select('hero-text'))
    fireEvent.click(within(overlay()).getByRole('button', { name: 'Excluir' }))
    expect(node('hero-text')).toBeUndefined()
  })

  it('edits text inline on double-click', async () => {
    setup()
    const doc = await frameDoc()
    fireEvent.doubleClick(el(doc, 'hero-title'))
    expect(store.getState().editingText).toBe('hero-title')
    const host = await waitFor(() => {
      const found = doc.querySelector('[data-canvas-inline] .ProseMirror')
      expect(found).toBeTruthy()
      return found as HTMLElement & {
        editor?: {
          commands: {
            setContent: (v: string) => void
            insertContent: (v: string) => void
          }
        }
      }
    })
    expect(screen.getByText(/Editando texto/)).toBeTruthy()
    act(() => {
      host.editor?.commands.insertContent('!')
    })
    expect(node('hero-title')?.props.text).toBe(
      'Internet de verdade para a sua empresa!',
    )
    fireEvent.click(el(doc, 'hero-text'))
    expect(store.getState().editingText).toBeNull()
  })

  it('opens the rich inline toolbar for rich text', async () => {
    setup()
    const doc = await frameDoc()
    fireEvent.doubleClick(el(doc, 'hero-text'))
    const toolbar = await screen.findByTestId('canvas-inline-toolbar')
    expect(toolbar.querySelectorAll('button').length).toBeGreaterThanOrEqual(6)
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Negrito' }))
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Link' }))
    fireEvent.change(screen.getByLabelText('Endereço do link'), {
      target: { value: 'stratus.com.br' },
    })
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByLabelText('Endereço do link')).toBeNull()
  })
})

describe('drag and drop', () => {
  function mockGeometry(doc: Document, hit: () => Element | null) {
    vi.spyOn(
      HTMLIFrameElement.prototype,
      'getBoundingClientRect',
    ).mockReturnValue({
      left: 0,
      top: 0,
      right: 4000,
      bottom: 4000,
      width: 4000,
      height: 4000,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    Object.defineProperty(doc, 'elementFromPoint', {
      configurable: true,
      value: hit,
    })
  }

  const tick = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

  async function keyboardDrag(handle: HTMLElement, steps = 1) {
    handle.focus()
    fireEvent.keyDown(handle, { code: 'Space', key: ' ' })
    // The keyboard sensor attaches its listeners on the next tick.
    await tick()
    for (let i = 0; i < steps; i++) {
      fireEvent.keyDown(document, { code: 'ArrowDown', key: 'ArrowDown' })
      await tick()
    }
  }

  it('drops a palette item into a canvas container (keyboard drag)', async () => {
    setup()
    const doc = await frameDoc()
    act(() => {
      store.dispatch({ kind: 'remove', id: 'hero-image' })
    })
    mockGeometry(doc, () => el(doc, 'hero-right'))
    await keyboardDrag(screen.getByTestId('palette-item-demo.heading'))
    expect(await screen.findByTestId('canvas-drop-inside')).toBeTruthy()
    expect(screen.getByTestId('canvas-drag-preview').textContent).toContain(
      'Título',
    )
    fireEvent.keyDown(document, { code: 'Space', key: ' ' })
    await waitFor(() => expect(node('hero-right')?.children).toHaveLength(1))
    const inserted = node(node('hero-right')?.children?.[0] as string)
    expect(inserted?.type).toBe('demo.heading')
    expect(store.getState().selection).toEqual([inserted?.id])
  })

  it('refuses an invalid target and inserts nothing', async () => {
    setup()
    const doc = await frameDoc()
    mockGeometry(doc, () => el(doc, 'root'))
    await keyboardDrag(screen.getByTestId('palette-item-demo.heading'))
    expect(await screen.findByTestId('canvas-drop-invalid')).toBeTruthy()
    fireEvent.keyDown(document, { code: 'Space', key: ' ' })
    await waitFor(() =>
      expect(screen.queryByTestId('canvas-drop-invalid')).toBeNull(),
    )
    expect(node('root')?.children).toEqual(['hero', 'features'])
  })

  it('moves a node by dragging its layer row onto another row', async () => {
    setup()
    const doc = await frameDoc()
    fireEvent.click(screen.getByRole('tab', { name: 'Camadas' }))
    const target = screen.getByTestId('layer-hero-right')
    mockGeometry(doc, () => null)
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(target)
    await keyboardDrag(screen.getByTestId('layer-hero-cta'))
    await waitFor(() =>
      expect(screen.getByTestId('layer-hero-right').className).toContain(
        'ring-primary',
      ),
    )
    fireEvent.keyDown(document, { code: 'Space', key: ' ' })
    await waitFor(() =>
      expect(node('hero-right')?.children).toEqual(['hero-image', 'hero-cta']),
    )
    expect(store.getState().selection).toEqual(['hero-cta'])
  })

  it('cancels a drag with Escape', async () => {
    setup()
    const doc = await frameDoc()
    mockGeometry(doc, () => el(doc, 'hero-text'))
    await keyboardDrag(screen.getByTestId('palette-item-demo.button'))
    expect(await screen.findByTestId('canvas-drop-inside')).toBeTruthy()
    fireEvent.keyDown(document, { code: 'Escape', key: 'Escape' })
    await waitFor(() =>
      expect(screen.queryByTestId('canvas-drop-inside')).toBeNull(),
    )
    expect(node('hero-left')?.children).toHaveLength(3)
  })
})
