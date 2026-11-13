'use client'

import {
  ComputerIcon,
  SidebarRightIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import { createCanvasStore } from '@/src/lib/canvas/store'
import type { CanvasDocument, CanvasFragment } from '@/src/lib/canvas/types'
import { CollabProvider, useCanvasCollaboration } from './collab/collab-context'
import type { CollabSession } from './collab/session'
import { CanvasDnd } from './dnd/canvas-dnd'
import { DraftBanner } from './draft-banner'
import { CanvasHint } from './empty-hint'
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
import {
  type CanvasDraft,
  clearDraft,
  draftStorageKey,
  readDraft,
  writeDraft,
} from './lib/draft-recovery'
import { createFrameHandle } from './lib/frame-handle'
import { historySkipMessage, opErrorMessage } from './lib/messages'
import { useCompactLayout } from './lib/use-compact-layout'
import { CanvasSidebar } from './sidebar/sidebar'
import { CanvasTopBar } from './top-bar'
import type { CanvasEditorProps } from './types'
import { CanvasStoreProvider } from './use-canvas'
import { useCanvasShortcuts } from './use-shortcuts'

/** Autosave delay after the last change. */
export const AUTOSAVE_MS = 1500

/**
 * Saves through `onSave` (REST) while there is no live co-editing session.
 * While live, the realtime server saves: changes are not sent here, and an
 * explicit save (Ctrl+S, publish, test send) asks the server to save now,
 * falling back to `onSave` when it does not confirm. Losing the connection
 * saves pending changes through REST right away.
 */
function useAutosave(
  ctx: Pick<CanvasEditorContextValue, 'store'>,
  onSave: CanvasEditorProps['onSave'],
  setStatus: (status: SaveStatus) => void,
  collab: CollabSession | null,
  draftKey: string | null,
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
      ok = (await collab?.flush()) || (await onSaveRef.current(doc))
    } catch {
      ok = false
    }
    saving.current = false
    if (ok) {
      store.markSaved(doc)
      clearDraft(draftKey)
      setStatus('saved')
    } else {
      // Keep a local copy so closing the tab does not lose the work.
      writeDraft(draftKey, doc)
      setStatus('error')
    }
    if (again.current) {
      again.current = false
      if (store.getState().dirty) return save()
    }
    return ok
  }, [store, setStatus, collab, draftKey])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let lastDoc = store.getState().doc
    const unsubscribe = store.subscribe(() => {
      const { doc, dirty } = store.getState()
      if (doc === lastDoc) return
      lastDoc = doc
      if (timer) clearTimeout(timer)
      if (dirty && !collab?.isLive()) {
        timer = setTimeout(() => void save(), AUTOSAVE_MS)
      }
    })
    let wasLive = collab?.isLive() ?? false
    const unsubscribeCollab = collab?.subscribe(() => {
      const live = collab.isLive()
      if (wasLive && !live && store.getState().dirty) void save()
      wasLive = live
    })
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      const pending = collab?.isLive()
        ? collab.getSnapshot().syncing
        : store.getState().dirty
      if (pending) event.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      unsubscribe()
      unsubscribeCollab?.()
      if (timer) clearTimeout(timer)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [store, save, collab])

  return save
}

/** Toasts a refused operation once. */
function useOpErrors() {
  const { store, catalog } = useCanvasEditor()
  useEffect(() => {
    let last = store.getState().lastError
    let lastSkip = store.getState().lastSkipped
    return store.subscribe(() => {
      const { lastError, lastSkipped } = store.getState()
      if (lastError && lastError !== last) {
        notify.error(opErrorMessage(lastError, catalog))
      }
      if (lastSkipped && lastSkipped !== lastSkip) {
        notify.warning(historySkipMessage(lastSkipped))
      }
      last = lastError
      lastSkip = lastSkipped
    })
  }, [store, catalog])
}

function EditorLayout({
  title,
  draft,
  onRestoreDraft,
  onDiscardDraft,
}: {
  title: CanvasEditorProps['title']
  draft: CanvasDraft | null
  onRestoreDraft: () => void
  onDiscardDraft: () => void
}) {
  useCanvasShortcuts()
  useOpErrors()
  const dragging = useDragState((state) => state.source !== null)
  const compact = useCompactLayout()
  const hasSelection = useCanvasStore((state) => state.selection.length > 0)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  // Below 1024 px the inspector is a drawer: it opens by itself when
  // something is selected and on request for the document settings.
  const showInspector = !compact || hasSelection || inspectorOpen
  return (
    <>
      <div
        data-testid='canvas-editor'
        data-compact={compact ? '' : undefined}
        data-dragging={dragging ? '' : undefined}
        className={cn(
          'hidden h-full min-h-0 w-full flex-col bg-background text-foreground md:flex',
          dragging &&
            'cursor-grabbing select-none [&_iframe]:pointer-events-none',
        )}
      >
        <CanvasTopBar title={title} />
        {draft && (
          <DraftBanner
            draft={draft}
            onRestore={onRestoreDraft}
            onDiscard={onDiscardDraft}
          />
        )}
        <div className='relative flex min-h-0 flex-1'>
          <CanvasSidebar compact={compact} />
          <main aria-label='Canvas' className='relative min-w-0 flex-1'>
            <CanvasStage />
            <CanvasHint />
            {compact && !showInspector && (
              <button
                type='button'
                aria-label='Abrir propriedades'
                title='Propriedades'
                onClick={() => setInspectorOpen(true)}
                className='absolute right-3 bottom-3 z-20 flex size-10 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-md hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none'
              >
                <SteelIcon icon={SidebarRightIcon} className='size-5' />
              </button>
            )}
          </main>
          {showInspector && (
            <CanvasInspector
              compact={compact}
              onClose={() => setInspectorOpen(false)}
            />
          )}
        </div>
      </div>
      <div className='flex h-full flex-col items-center justify-center gap-3 px-6 py-16 text-center md:hidden'>
        <span className='flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary'>
          <SteelIcon icon={ComputerIcon} className='size-6' />
        </span>
        <h2 className='text-base font-semibold'>
          Use uma tela maior para editar
        </h2>
        <p className='max-w-sm text-sm text-muted-foreground'>
          O editor visual precisa de pelo menos 768 px de largura. Abra em um
          tablet, em um computador ou amplie a janela.
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
  const collab = useCanvasCollaboration(store, props.collaboration)
  const [draftKey] = useState(() => draftStorageKey(props.draftKey))
  const save = useAutosave(
    { store },
    props.onSave,
    setSaveStatus,
    collab,
    draftKey,
  )
  // A copy kept after a failed save. Not offered while co-editing: the
  // realtime server is the source of truth there.
  const [draft, setDraft] = useState<CanvasDraft | null>(null)
  useEffect(() => {
    if (props.collaboration) return
    const found = readDraft(draftKey)
    if (!found) return
    const current = JSON.stringify(store.getState().doc.nodes)
    if (JSON.stringify(found.doc.nodes) === current) {
      clearDraft(draftKey)
      return
    }
    setDraft(found)
  }, [draftKey, store, props.collaboration])
  const restoreDraft = useCallback(() => {
    if (!draft) return
    const saved: CanvasDocument = store.getState().doc
    store.reset(draft.doc)
    // The server still has the previous document, so the restored one is
    // pending: baseline = what was loaded, then save.
    store.markSaved(saved)
    setDraft(null)
    void save()
  }, [draft, store, save])
  const discardDraft = useCallback(() => {
    clearDraft(draftKey)
    setDraft(null)
  }, [draftKey])

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
          <CollabProvider value={collab}>
            <CanvasDnd>
              <EditorLayout
                title={props.title}
                draft={draft}
                onRestoreDraft={restoreDraft}
                onDiscardDraft={discardDraft}
              />
            </CanvasDnd>
          </CollabProvider>
        </CanvasEditorUiProvider>
      </CanvasEditorContextProvider>
    </CanvasStoreProvider>
  )
}
