'use client'

import type { IconSvgElement } from '@hugeicons/react'
import { SquareIcon } from '@hugeicons-pro/core-stroke-rounded'
import { createContext, useContext, useSyncExternalStore } from 'react'
import type { CanvasCatalog } from '@/src/lib/canvas/registry'
import type { CanvasStore } from '@/src/lib/canvas/store'
import type { CanvasFragment } from '@/src/lib/canvas/types'
import type { DragState, DragStore } from './lib/drag-store'
import type { FrameHandle } from './lib/frame-handle'
import type { CanvasEditorProps } from './types'

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export interface CanvasEditorContextValue {
  catalog: CanvasCatalog
  store: CanvasStore
  drag: DragStore
  frame: FrameHandle
  props: CanvasEditorProps
  /** Saves now (Ctrl+S, "Salvar"). Resolves `true` when saved. */
  save: () => Promise<boolean>
  clipboard: { current: CanvasFragment | null }
}

/** Fast-changing editor chrome state, kept out of the main context so the
 * canvas nodes never re-render for it. */
export interface CanvasEditorUi {
  dark: boolean
  setDark: (dark: boolean) => void
  saveStatus: SaveStatus
}

const EditorContext = createContext<CanvasEditorContextValue | null>(null)
const EditorUiContext = createContext<CanvasEditorUi>({
  dark: false,
  setDark: () => {},
  saveStatus: 'idle',
})

export const CanvasEditorContextProvider = EditorContext.Provider
export const CanvasEditorUiProvider = EditorUiContext.Provider

export function useCanvasEditorUi(): CanvasEditorUi {
  return useContext(EditorUiContext)
}

export function useCanvasEditor(): CanvasEditorContextValue {
  const value = useContext(EditorContext)
  if (!value) throw new Error('Canvas UI must be used inside <CanvasEditor>')
  return value
}

/** Icon of a catalog name ("text", "image"…), with a neutral fallback. */
export function resolveIcon(
  catalog: CanvasCatalog,
  name: string | undefined,
): IconSvgElement {
  return (name && catalog.icons?.[name]) || SquareIcon
}

export function useDragState<T>(selector: (state: DragState) => T): T {
  const { drag } = useCanvasEditor()
  return useSyncExternalStore(
    drag.subscribe,
    () => selector(drag.get()),
    () => selector(drag.get()),
  )
}

/** Re-renders when the frame layout changes (resize, zoom, load). */
export function useFrameVersion(): number {
  const { frame } = useCanvasEditor()
  return useSyncExternalStore(
    frame.subscribe,
    frame.getVersion,
    frame.getVersion,
  )
}
