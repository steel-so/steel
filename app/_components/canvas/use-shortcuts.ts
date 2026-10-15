'use client'

import { useEffect } from 'react'
import { getNode, parentOf } from '@/src/lib/canvas/ops'
import type { CanvasStore } from '@/src/lib/canvas/store'
import type { CanvasFragment, CanvasNodeId } from '@/src/lib/canvas/types'
import {
  type CanvasEditorContextValue,
  useCanvasEditor,
} from './editor-context'
import { DEFAULT_VIEWPORTS, fitZoom } from './frame/canvas-stage'
import { stepZoom } from './top-bar'

/** Keys typed into a field belong to the field. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element || typeof element.closest !== 'function') return false
  if (element.isContentEditable) return true
  return !!element.closest(
    'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"], [role="combobox"], [role="listbox"], [role="menu"], [role="dialog"]',
  )
}

function siblingOf(store: CanvasStore, id: CanvasNodeId, delta: 1 | -1) {
  const { doc } = store.getState()
  const parent = parentOf(doc, id)
  if (parent === null) return null
  const siblings = getNode(doc, parent)?.children ?? []
  return siblings[siblings.indexOf(id) + delta] ?? null
}

/** Moves the selected node one slot up/down among its siblings. */
function nudge(store: CanvasStore, id: CanvasNodeId, delta: 1 | -1) {
  const { doc } = store.getState()
  const parent = parentOf(doc, id)
  if (parent === null) return
  const siblings = getNode(doc, parent)?.children ?? []
  const index = siblings.indexOf(id)
  const target = delta === 1 ? index + 2 : index - 1
  if (target < 0 || target > siblings.length) return
  store.dispatch(
    { kind: 'move', id, to: { parentId: parent, index: target } },
    { label: 'move' },
  )
}

/**
 * Handles one keydown for the editor. Returns `true` when it consumed the
 * event. Exported for tests.
 */
export function handleEditorKey(
  event: KeyboardEvent,
  ctx: Pick<
    CanvasEditorContextValue,
    'store' | 'catalog' | 'clipboard' | 'save' | 'frame' | 'props'
  >,
): boolean {
  const { store, clipboard } = ctx
  const mod = event.ctrlKey || event.metaKey
  const key = event.key.toLowerCase()

  if (mod && key === 's') {
    void ctx.save()
    return true
  }
  if (isTypingTarget(event.target)) return false
  const state = store.getState()
  if (state.editingText) return false
  const selection = state.selection
  const first = selection[0]

  if (mod && key === 'z') {
    if (event.shiftKey) store.redo()
    else store.undo()
    return true
  }
  if (mod && key === 'y') {
    store.redo()
    return true
  }
  if (mod && (key === '=' || key === '+')) {
    store.setZoom(stepZoom(state.zoom, 1))
    return true
  }
  if (mod && key === '-') {
    store.setZoom(stepZoom(state.zoom, -1))
    return true
  }
  if (mod && key === '0') {
    const width =
      ctx.props.viewportWidths[state.breakpoint] ??
      DEFAULT_VIEWPORTS[state.breakpoint]
    store.setZoom(fitZoom(width, ctx.frame.scroller?.clientWidth ?? 0))
    return true
  }
  if (mod && (key === 'c' || key === 'x')) {
    if (selection.length === 0) return false
    const fragment: CanvasFragment | null = store.copy(selection)
    if (!fragment) return false
    clipboard.current = fragment
    if (key === 'x') store.remove(selection)
    return true
  }
  if (mod && key === 'v') {
    if (!clipboard.current) return false
    store.paste(clipboard.current)
    return true
  }
  if (mod && key === 'd') {
    if (selection.length === 0) return false
    store.duplicate(selection)
    return true
  }
  if (event.key === 'Delete' || event.key === 'Backspace') {
    if (selection.length === 0) return false
    store.remove(selection)
    return true
  }
  if (event.key === 'Escape') {
    if (!first) return false
    const parent = parentOf(state.doc, first)
    store.select(parent && parent !== state.doc.rootId ? parent : null)
    return true
  }
  if (!first) return false
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    const delta = event.key === 'ArrowUp' ? -1 : 1
    if (event.altKey) nudge(store, first, delta)
    else {
      const next = siblingOf(store, first, delta)
      if (next) store.select(next)
    }
    return true
  }
  if (event.key === 'ArrowLeft') {
    const parent = parentOf(state.doc, first)
    if (parent && parent !== state.doc.rootId) store.select(parent)
    return true
  }
  if (event.key === 'ArrowRight') {
    const child = getNode(state.doc, first)?.children?.[0]
    if (child) store.select(child)
    return true
  }
  if (event.key === 'Enter') {
    const node = getNode(state.doc, first)
    if (node && ctx.catalog.components[node.type]?.inlineText) {
      store.setEditingText(first)
      return true
    }
  }
  return false
}

/** Editor keyboard shortcuts on the page and inside the canvas iframe. */
export function useCanvasShortcuts() {
  const ctx = useCanvasEditor()
  const { frame } = ctx

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (handleEditorKey(event, ctx)) event.preventDefault()
    }
    let frameDoc: Document | null = null
    const attachFrame = () => {
      if (frame.document === frameDoc) return
      frameDoc?.removeEventListener('keydown', onKey)
      frameDoc = frame.document
      frameDoc?.addEventListener('keydown', onKey)
    }
    window.addEventListener('keydown', onKey)
    attachFrame()
    const unsubscribe = frame.subscribe(attachFrame)
    return () => {
      window.removeEventListener('keydown', onKey)
      frameDoc?.removeEventListener('keydown', onKey)
      unsubscribe()
    }
  }, [ctx, frame])
}
