'use client'

import { ComputerIcon } from '@hugeicons-pro/core-stroke-rounded'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import { createCanvasStore } from '@/src/lib/canvas/store'
import type { CanvasFragment } from '@/src/lib/canvas/types'
import { CanvasDnd } from './dnd/canvas-dnd'
import {
  CanvasEditorContextProvider,
  type CanvasEditorContextValue,
  CanvasEditorUiProvider,
  type SaveStatus,
  useCanvasEditor,
  useDragState,
} from './editor-context'
import { CanvasStage } from './frame/canvas-stage'
import { CanvasInspector } from './inspector/inspector'
import { createDragStore } from './lib/drag-store'
import { createFrameHandle } from './lib/frame-handle'
import { opErrorMessage } from './lib/messages'
import { CanvasSidebar } from './sidebar/sidebar'
import { CanvasTopBar } from './top-bar'
import type { CanvasEditorProps } from './types'
import { CanvasStoreProvider } from './use-canvas'
import { useCanvasShortcuts } from './use-shortcuts'

/** Autosave delay after the last change. */
export const AUTOSAVE_MS = 1500

function useAutosave(
  ctx: Pick<CanvasEditorContextValue, 'store'>,
  onSave: CanvasEditorProps['onSave'],
  setStatus: (status: SaveStatus) => void,
) {
  const { store } = ctx
  const onSaveRef = useRef(onSave)
  onSaveRef.current = onSave
  const saving = useRef(false)
  const again = useRef(false)

  const save = useCallback(async (): Promise<boolean> => {
    if (saving.current) {
      again.current = true
      return false
    }
    const { doc, dirty } = store.getState()
    if (!dirty) return true
    saving.current = true
    setStatus('saving')
    let ok = false
    try {
      ok = await onSaveRef.current(doc)
    } catch {
      ok = false
    }
    saving.current = false
    if (ok) {
      store.markSaved(doc)
      setStatus('saved')
    } else {
      setStatus('error')
    }
    if (again.current) {
      again.current = false
      if (store.getState().dirty) return save()
    }
    return ok
  }, [store, setStatus])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let lastDoc = store.getState().doc
    const unsubscribe = store.subscribe(() => {
      const { doc, dirty } = store.getState()
      if (doc === lastDoc) return
      lastDoc = doc
      if (timer) clearTimeout(timer)
      if (dirty) timer = setTimeout(() => void save(), AUTOSAVE_MS)
    })
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (store.getState().dirty) event.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      unsubscribe()
      if (timer) clearTimeout(timer)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [store, save])

  return save
}

/** Toasts a refused operation once. */
function useOpErrors() {
  const { store, catalog } = useCanvasEditor()
  useEffect(() => {
    let last = store.getState().lastError
    return store.subscribe(() => {
      const { lastError } = store.getState()
      if (lastError && lastError !== last) {
        notify.error(opErrorMessage(lastError, catalog))
      }
      last = lastError
    })
  }, [store, catalog])
}

function EditorLayout({ title }: { title: CanvasEditorProps['title'] }) {
  useCanvasShortcuts()
  useOpErrors()
  const dragging = useDragState((state) => state.source !== null)
  return (
    <>
      <div
        data-testid='canvas-editor'
        data-dragging={dragging ? '' : undefined}
        className={cn(
          'hidden h-full min-h-0 w-full flex-col bg-background text-foreground lg:flex',
          dragging &&
            'cursor-grabbing select-none [&_iframe]:pointer-events-none',
        )}
      >
        <CanvasTopBar title={title} />
        <div className='flex min-h-0 flex-1'>
          <CanvasSidebar />
          <main aria-label='Canvas' className='min-w-0 flex-1'>
            <CanvasStage />
          </main>
          <CanvasInspector />
        </div>
      </div>
      <div className='flex h-full flex-col items-center justify-center gap-3 px-6 py-16 text-center lg:hidden'>
        <span className='flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary'>
          <SteelIcon icon={ComputerIcon} className='size-6' />
        </span>
        <h2 className='text-base font-semibold'>
          Use uma tela maior para editar
        </h2>
        <p className='max-w-sm text-sm text-muted-foreground'>
          O editor visual precisa de pelo menos 1024 px de largura para mostrar
          a barra lateral, o canvas e as propriedades lado a lado. Abra em um
          computador ou amplie a janela.
        </p>
      </div>
    </>
  )
}

/**
 * Steel Canvas editor shell: top bar, sidebar (Adicionar, Camadas, catalog
 * tabs), the iframe canvas with its editing overlay and the generated
 * inspector. The catalog decides what can be built; the store (from
 * `src/lib/canvas`) holds the document, history and selection.
 */
export function CanvasEditor(props: CanvasEditorProps) {
  const [store] = useState(
    () =>
      props.store ?? createCanvasStore(props.catalog, props.initialDocument),
  )
  const [drag] = useState(createDragStore)
  const [frame] = useState(createFrameHandle)
  const clipboard = useRef<CanvasFragment | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [dark, setDark] = useState(false)
  const save = useAutosave({ store }, props.onSave, setSaveStatus)

  const value = useMemo<CanvasEditorContextValue>(
    () => ({
      catalog: props.catalog,
      store,
      drag,
      frame,
      props,
      save,
      clipboard,
    }),
    [props, store, drag, frame, save],
  )
  const ui = useMemo(() => ({ dark, setDark, saveStatus }), [dark, saveStatus])

  return (
    <CanvasStoreProvider store={store}>
      <CanvasEditorContextProvider value={value}>
        <CanvasEditorUiProvider value={ui}>
          <CanvasDnd>
            <EditorLayout title={props.title} />
          </CanvasDnd>
        </CanvasEditorUiProvider>
      </CanvasEditorContextProvider>
    </CanvasStoreProvider>
  )
}
