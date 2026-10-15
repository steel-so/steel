import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { getNode } from '@/src/lib/canvas/ops'
import type { CanvasStore } from '@/src/lib/canvas/store'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import { siteCatalog } from '@/src/lib/canvas-site/catalog'
import { SITE_TYPES } from '@/src/lib/canvas-site/constants'
import {
  box,
  heading,
  section,
  spec,
  text,
  toDocument,
} from '@/src/lib/canvas-site/presets/builder'
import { CanvasEditor } from '../canvas-editor'
import { snapBox, snapLines } from '../lib/snap'

vi.mock('@/lib/notify', () => ({
  notify: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

let store: CanvasStore

function setup(doc: CanvasDocument) {
  render(
    <CanvasEditor
      catalog={siteCatalog}
      initialDocument={doc}
      viewportWidths={{ base: 1280, tablet: 768, mobile: 375 }}
      title='Teste'
      actions={(ctx) => {
        store = ctx.store
        return null
      }}
      onSave={async () => true}
    />,
  )
}

async function frame(): Promise<Document> {
  const iframe = screen.getByTestId('canvas-frame') as HTMLIFrameElement
  await waitFor(() =>
    expect(iframe.contentDocument?.querySelector('.s-site')).toBeTruthy(),
  )
  return iframe.contentDocument as Document
}

const ofType = (doc: CanvasDocument, type: string) =>
  Object.values(doc.nodes).filter((node) => node.type === type)

describe('snapping', () => {
  const lines = snapLines({ width: 1000, height: 400 }, [
    { x: 100, y: 50, width: 200, height: 100 },
  ])

  it('lists the container and sibling guide lines', () => {
    expect(lines.x).toEqual([0, 500, 1000, 100, 200, 300])
    expect(lines.y).toEqual([0, 200, 400, 50, 100, 150])
  })

  it('snaps the closest edge or center within the threshold', () => {
    expect(snapBox({ x: 403, y: 47, width: 200, height: 20 }, lines)).toEqual({
      x: 400,
      y: 50,
      guides: { x: [500], y: [50] },
    })
    expect(snapBox({ x: 640.4, y: 300, width: 10, height: 10 }, lines)).toEqual(
      {
        x: 640,
        y: 300,
        guides: { x: [], y: [] },
      },
    )
    expect(
      snapBox({ x: 403, y: 47, width: 200, height: 20 }, lines, { free: true }),
    ).toEqual({ x: 403, y: 47, guides: { x: [], y: [] } })
  })
})

describe('elements that follow the selection', () => {
  it('shows the selected slide and selects slides from the dots', async () => {
    const doc = toDocument([
      section({}, [
        spec(
          SITE_TYPES.carousel,
          {},
          [1, 2, 3].map((n) =>
            spec(SITE_TYPES.slide, {}, [heading('h3', `Slide ${n}`)]),
          ),
        ),
      ]),
    ])
    const slides = ofType(doc, SITE_TYPES.slide).map((slide) => slide.id)
    const carousel = ofType(doc, SITE_TYPES.carousel)[0].id
    setup(doc)
    const iframe = await frame()
    expect(iframe.body.textContent).toContain('Slide 1')
    act(() =>
      store.select(
        getNode(store.getState().doc, slides[2])?.children?.[0] ?? null,
      ),
    )
    expect(iframe.body.textContent).not.toContain('Slide 1')
    expect(iframe.body.textContent).toContain('Slide 3')
    // Selecting the carousel keeps the slide in view.
    act(() => store.select(carousel))
    expect(iframe.body.textContent).toContain('Slide 3')
    expect(iframe.body.textContent).not.toContain('Slide 2')
    fireEvent.click(iframe.querySelector('[data-s-dot="1"]') as Element)
    expect(store.getState().selection).toEqual([slides[1]])
    expect(iframe.body.textContent).toContain('Slide 2')
    // A removed slide is forgotten.
    act(() => store.remove([slides[1]]))
    expect(iframe.body.textContent).toContain('Slide 1')
  })

  it('switches tabs, opens popups from their chip and keeps accordions open while editing', async () => {
    const doc = toDocument([
      section({}, [
        spec(SITE_TYPES.tabs, {}, [
          spec(SITE_TYPES.tab, { label: 'Um' }, [text('Painel um')]),
          spec(SITE_TYPES.tab, { label: 'Dois' }, [text('Painel dois')]),
        ]),
        spec(SITE_TYPES.accordion, {}, [
          spec(SITE_TYPES.accordionItem, { title: 'Pergunta' }, [
            text('Resposta'),
          ]),
        ]),
      ]),
      spec(SITE_TYPES.popup, { name: 'Oferta' }, [heading('h2', 'Na janela')]),
    ])
    setup(doc)
    const iframe = await frame()
    expect(iframe.body.textContent).toContain('Painel um')
    fireEvent.click(iframe.querySelector('[role=tab]:nth-child(2)') as Element)
    expect(iframe.body.textContent).toContain('Painel dois')
    expect(iframe.body.textContent).not.toContain('Painel um')

    expect(iframe.body.textContent).not.toContain('Na janela')
    fireEvent.click(iframe.querySelector('.s-popup-chip') as Element)
    expect(store.getState().selection).toEqual([
      ofType(doc, SITE_TYPES.popup)[0].id,
    ])
    expect(iframe.body.textContent).toContain('Na janela')

    const summary = iframe.querySelector('summary') as HTMLElement
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    summary.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(true)
    expect(store.getState().selection).toEqual([
      ofType(doc, SITE_TYPES.accordionItem)[0].id,
    ])
    await waitFor(() =>
      expect(iframe.querySelector('details')?.hasAttribute('open')).toBe(true),
    )
  })
})

describe('free positioning on the canvas', () => {
  function freeDoc() {
    return toDocument([
      section({}, [
        box({ positioning: 'free' }, [heading('h2', 'Livre'), text('Vizinho')]),
      ]),
    ])
  }

  it('drags the selected child and writes its position for the breakpoint', async () => {
    const doc = freeDoc()
    const title = ofType(doc, SITE_TYPES.heading)[0].id
    setup(doc)
    await frame()
    expect(screen.queryByTestId('canvas-free-drag')).toBeNull()
    act(() => store.select(title))
    const surface = await screen.findByTestId('canvas-free-drag')
    fireEvent.pointerDown(surface, {
      button: 0,
      pointerId: 1,
      clientX: 10,
      clientY: 10,
    })
    fireEvent.pointerMove(surface, { pointerId: 1, clientX: 10.5, clientY: 10 })
    expect(getNode(store.getState().doc, title)?.props.place).toBeUndefined()
    fireEvent.pointerMove(surface, {
      pointerId: 1,
      clientX: 410,
      clientY: 210,
      altKey: true,
    })
    const place = getNode(store.getState().doc, title)?.props.place as {
      x: number
      y: number
    }
    expect(place.x).toBeGreaterThan(0)
    expect(place.y).toBeGreaterThan(0)
    expect(place.x / place.y).toBeCloseTo(2, 0)
    fireEvent.pointerMove(surface, { pointerId: 2, clientX: 900, clientY: 900 })
    fireEvent.pointerUp(surface, { pointerId: 1 })
    fireEvent.pointerMove(surface, { pointerId: 1, clientX: 900, clientY: 900 })
    const after = getNode(store.getState().doc, title)?.props.place as {
      x: number
    }
    expect(after.x).toBe(place.x)
    expect(screen.queryAllByTestId('canvas-snap-guide')).toHaveLength(0)

    // On mobile the value becomes responsive, base keeps its own.
    act(() => store.setBreakpoint('mobile'))
    const mobileSurface = await screen.findByTestId('canvas-free-drag')
    fireEvent.pointerDown(mobileSurface, {
      button: 0,
      pointerId: 3,
      clientX: 0,
      clientY: 0,
    })
    fireEvent.pointerMove(mobileSurface, {
      pointerId: 3,
      clientX: 30,
      clientY: 30,
      altKey: true,
    })
    fireEvent.pointerCancel(mobileSurface, { pointerId: 3 })
    const responsive = getNode(store.getState().doc, title)?.props.place as {
      x: { base: number; mobile: number }
    }
    expect(responsive.x.base).toBe(place.x)
    expect(typeof responsive.x.mobile).toBe('number')
  })

  it('ignores other buttons and opens the inline editor on double-click', async () => {
    const doc = freeDoc()
    const title = ofType(doc, SITE_TYPES.heading)[0].id
    setup(doc)
    await frame()
    act(() => store.select(title))
    const surface = await screen.findByTestId('canvas-free-drag')
    fireEvent.pointerDown(surface, { button: 2, pointerId: 1 })
    fireEvent.pointerMove(surface, { pointerId: 1, clientX: 300, clientY: 300 })
    expect(getNode(store.getState().doc, title)?.props.place).toBeUndefined()
    fireEvent.doubleClick(surface)
    expect(store.getState().editingText).toBe(title)
  })

  it('shows snapping guides near the container edges', async () => {
    const doc = freeDoc()
    const title = ofType(doc, SITE_TYPES.heading)[0].id
    setup(doc)
    await frame()
    act(() => store.select(title))
    const surface = await screen.findByTestId('canvas-free-drag')
    fireEvent.pointerDown(surface, {
      button: 0,
      pointerId: 1,
      clientX: 0,
      clientY: 0,
    })
    // jsdom has no layout: every box and guide sits at 0, so a small move
    // (past the 2 px dead zone, inside the 6 px snap distance) snaps back.
    fireEvent.pointerMove(surface, { pointerId: 1, clientX: 3, clientY: 4 })
    expect(getNode(store.getState().doc, title)?.props.place).toEqual({
      x: 0,
      y: 0,
    })
    expect(screen.getAllByTestId('canvas-snap-guide')).toHaveLength(2)
  })
})
