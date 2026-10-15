'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { getNode, parentOf } from '@/src/lib/canvas/ops'
import type { CanvasStore } from '@/src/lib/canvas/store'
import type { CanvasNodeId } from '@/src/lib/canvas/types'
import { useCanvasEditor, useCanvasEditorUi } from '../editor-context'
import { nodeIdAt } from '../lib/frame-handle'
import { useCanvasStore } from '../use-canvas'
import { InlineTextEditor } from './inline-text'
import { DocumentView } from './node-view'

/** Base styles of the canvas document. Nothing here reaches the output. */
const FRAME_CSS = `
html,body{margin:0;padding:0}
body{-webkit-font-smoothing:antialiased;min-height:100%}
#canvas-root{min-height:100%}
*{-webkit-user-select:none;user-select:none}
a,button{cursor:default}
img{-webkit-user-drag:none}
[data-canvas-inline],[data-canvas-inline] *{-webkit-user-select:text;user-select:text;cursor:text}
[data-canvas-inline] .ProseMirror{outline:none;white-space:pre-wrap;word-wrap:break-word}
[data-canvas-inline] .ProseMirror p{margin:var(--canvas-p-mt,0) 0 var(--canvas-p-mb,0)}
[data-canvas-inline] .ProseMirror ul,[data-canvas-inline] .ProseMirror ol{margin:0;padding-left:1.4em}
html[data-canvas-dark]{filter:invert(1) hue-rotate(180deg)}
html[data-canvas-dark] img{filter:invert(1) hue-rotate(180deg)}
`

/** First ancestor-or-self that can be picked on the canvas (locked nodes
 * pass the click to their parent). */
export function selectableId(
  store: CanvasStore,
  id: CanvasNodeId | null,
): CanvasNodeId | null {
  const { doc } = store.getState()
  for (let current = id; current !== null; current = parentOf(doc, current)) {
    const node = getNode(doc, current)
    if (node && !node.meta?.locked) return current
  }
  return null
}

function isInlineTarget(target: EventTarget | null): boolean {
  const element = target as Element | null
  return !!element?.closest?.('[data-canvas-inline]')
}

/**
 * The canvas iframe. The document is rendered with a React portal into the
 * iframe's body (same React tree, same store) so the catalog's real
 * components render with isolated CSS. The iframe grows with its content;
 * the stage around it scrolls.
 */
export function CanvasFrame({
  width,
  minHeight,
}: {
  width: number
  minHeight: number
}) {
  const { frame, store, catalog, props, drag } = useCanvasEditor()
  const { dark } = useCanvasEditorUi()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [mount, setMount] = useState<{
    doc: Document
    root: HTMLElement
  } | null>(null)
  const [height, setHeight] = useState(minHeight)
  const editingText = useCanvasStore((state) => state.editingText)

  // Prepare the iframe document (again if the browser swaps it on load).
  useLayoutEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) return
    const setup = () => {
      const doc = iframe.contentDocument
      if (!doc || doc === frame.document || !doc.body) return
      const style = doc.createElement('style')
      style.setAttribute('data-canvas-base', '')
      style.textContent = FRAME_CSS
      doc.head.appendChild(style)
      const root = doc.createElement('div')
      root.id = 'canvas-root'
      doc.body.appendChild(root)
      frame.iframe = iframe
      frame.document = doc
      setMount({ doc, root })
      frame.notify()
    }
    setup()
    iframe.addEventListener('load', setup)
    return () => {
      iframe.removeEventListener('load', setup)
      frame.iframe = null
      frame.document = null
    }
  }, [frame])

  // Grow with the content.
  useEffect(() => {
    if (!mount) return
    const view = mount.doc.defaultView
    const Observer =
      (view as (Window & typeof globalThis) | null)?.ResizeObserver ??
      globalThis.ResizeObserver
    const measure = () => {
      setHeight(Math.ceil(mount.root.getBoundingClientRect().height))
      frame.notify()
    }
    measure()
    const observer = new Observer(measure)
    observer.observe(mount.root)
    return () => observer.disconnect()
  }, [mount, frame])

  // Selection, hover and inline-edit gestures inside the frame.
  useEffect(() => {
    if (!mount) return
    const { doc } = mount
    const dragging = () => drag.get().source !== null

    const onPointerMove = (event: PointerEvent) => {
      if (dragging() || isInlineTarget(event.target)) return
      const id = selectableId(store, nodeIdAt(event.target))
      if (store.getState().hovered !== id) store.hover(id)
    }
    const onPointerLeave = () => {
      if (store.getState().hovered !== null) store.hover(null)
    }
    const onClick = (event: MouseEvent) => {
      const target = event.target as Element | null
      if (target?.closest?.('a')) event.preventDefault()
      if (isInlineTarget(event.target)) return
      const state = store.getState()
      if (state.editingText) store.setEditingText(null)
      const id = selectableId(store, nodeIdAt(event.target))
      if (!id || id === state.doc.rootId) {
        store.select(id === state.doc.rootId ? [] : null)
        return
      }
      if (event.shiftKey || event.metaKey || event.ctrlKey) {
        const has = state.selection.includes(id)
        store.select(
          has
            ? state.selection.filter((selected) => selected !== id)
            : [...state.selection, id],
        )
        return
      }
      store.select(id)
    }
    const onDoubleClick = (event: MouseEvent) => {
      if (isInlineTarget(event.target)) return
      const id = selectableId(store, nodeIdAt(event.target))
      if (!id) return
      const node = getNode(store.getState().doc, id)
      if (node && catalog.components[node.type]?.inlineText) {
        event.preventDefault()
        store.select(id)
        store.setEditingText(id)
      }
    }
    const onSubmit = (event: Event) => event.preventDefault()

    doc.addEventListener('pointermove', onPointerMove)
    doc.addEventListener('pointerleave', onPointerLeave)
    doc.documentElement.addEventListener('mouseleave', onPointerLeave)
    doc.addEventListener('click', onClick)
    doc.addEventListener('dblclick', onDoubleClick)
    doc.addEventListener('submit', onSubmit, true)
    return () => {
      doc.removeEventListener('pointermove', onPointerMove)
      doc.removeEventListener('pointerleave', onPointerLeave)
      doc.documentElement.removeEventListener('mouseleave', onPointerLeave)
      doc.removeEventListener('click', onClick)
      doc.removeEventListener('dblclick', onDoubleClick)
      doc.removeEventListener('submit', onSubmit, true)
    }
  }, [mount, store, catalog, drag])

  useEffect(() => {
    if (!mount) return
    const html = mount.doc.documentElement
    if (dark) html.setAttribute('data-canvas-dark', '')
    else html.removeAttribute('data-canvas-dark')
  }, [mount, dark])

  return (
    <iframe
      ref={iframeRef}
      title='Área de edição'
      data-testid='canvas-frame'
      className='block border-0 bg-white'
      style={{ width, height: Math.max(height, minHeight) }}
      tabIndex={-1}
    >
      {mount &&
        createPortal(
          <>
            {props.frameHead && createPortal(props.frameHead, mount.doc.head)}
            {props.frameBefore}
            <DocumentView />
            {props.frameAfter}
            {editingText && (
              <InlineTextEditor key={editingText} id={editingText} />
            )}
          </>,
          mount.root,
        )}
    </iframe>
  )
}
