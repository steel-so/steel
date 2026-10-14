'use client'

import {
  createContext,
  createElement,
  type ReactNode,
  useContext,
  useRef,
  useSyncExternalStore,
} from 'react'
import { getNode } from '@/src/lib/canvas/ops'
import type { CanvasEditorState, CanvasStore } from '@/src/lib/canvas/store'
import type { CanvasNode, CanvasNodeId } from '@/src/lib/canvas/types'

/**
 * React binding of the framework-free canvas store. Components read slices of
 * the editor state through `useCanvasStore(selector)` and re-render only when
 * their slice changes; actions go through `useCanvasStoreApi()`.
 */

const CanvasStoreContext = createContext<CanvasStore | null>(null)

export function CanvasStoreProvider({
  store,
  children,
}: {
  store: CanvasStore
  children?: ReactNode
}) {
  return createElement(CanvasStoreContext, { value: store }, children)
}

/** The store of the nearest `CanvasStoreProvider` (dispatch, undo, select…). */
export function useCanvasStoreApi(): CanvasStore {
  const store = useContext(CanvasStoreContext)
  if (!store) {
    throw new Error('Canvas hooks must be used inside <CanvasStoreProvider>')
  }
  return store
}

/** Same arrays/objects by their own entries (one level deep). */
export function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true
  if (
    typeof a !== 'object' ||
    typeof b !== 'object' ||
    a === null ||
    b === null
  ) {
    return false
  }
  const keysA = Object.keys(a)
  const keysB = Object.keys(b)
  return (
    keysA.length === keysB.length &&
    keysA.every(
      (key) =>
        Object.hasOwn(b, key) &&
        Object.is(
          (a as Record<string, unknown>)[key],
          (b as Record<string, unknown>)[key],
        ),
    )
  )
}

/**
 * Subscribes to a slice of the editor state. The selector may be an inline
 * function; a selector that builds a new object/array each time should pass
 * `isEqual` (e.g. `shallowEqual`) so equal results keep their identity and do
 * not re-render.
 */
export function useCanvasStore<T>(
  selector: (state: CanvasEditorState) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  const store = useCanvasStoreApi()
  const cache = useRef<{
    state: CanvasEditorState
    selector: (state: CanvasEditorState) => T
    value: T
  } | null>(null)

  const getSnapshot = (): T => {
    const state = store.getState()
    const cached = cache.current
    if (cached && cached.state === state && cached.selector === selector) {
      return cached.value
    }
    const selected = selector(state)
    const value =
      cached && isEqual(cached.value, selected) ? cached.value : selected
    cache.current = { state, selector, value }
    return value
  }

  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot)
}

/** One node of the document. Structural sharing keeps the object identical
 * until an op touches it, so memoized renderers skip untouched nodes. */
export function useCanvasNode(id: CanvasNodeId): CanvasNode | undefined {
  return useCanvasStore((state) => getNode(state.doc, id))
}
