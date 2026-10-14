'use client'

import type { Value } from 'platejs'
import type { PlateEditor } from 'platejs/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  useShortcut,
  useShortcuts,
} from '@/app/_components/shortcuts/shortcuts-provider'
import { createEditorExporter } from '@/components/editor/ui/export-toolbar-button'
import {
  WikiPageRichEditor,
  type WikiSyncStatus,
} from '@/components/editor/wiki-editor'
import { notify } from '@/lib/notify'
import {
  useUpdateWikiPage,
  useWikiAi,
  useWikiLabels,
  useWikiPages,
} from '@/src/hooks/use-wiki-page'
import { wikiAncestors } from '@/src/lib/wiki-tree'
import type { WikiAiAction, WikiPageDTO } from '@/types/wiki-page'
import { useWikiPreferences } from './use-wiki-preferences'
import {
  WikiBlockAiContext,
  type WikiBlockAiContextValue,
  WikiBlockAiSlot,
} from './wiki-block-ai'
import { editorMarkdown } from './wiki-markdown'
import { WikiPageHeader } from './wiki-page-header'
import type { WikiExportKind } from './wiki-page-more-menu'
import { WikiPageTopBar } from './wiki-page-top-bar'
import { presenceFromAwareness, type WikiPresenceUser } from './wiki-presence'
import { WikiSidePanel } from './wiki-side-panel'
import { WikiToolbar } from './wiki-toolbar'

// The real content is already synced in real time via Yjs/Hocuspocus —
// this autosave only keeps WikiPage.content (the flat JSON snapshot, used
// for listing/search outside the Yjs doc) up to date. Since nothing depends
// on it to avoid losing keystrokes, a larger debounce here only reduces
// write frequency with no real risk of data loss.
const AUTOSAVE_DELAY_MS = 1500 // ms
// The side panel's numbers and outline follow the text a beat behind.
const PANEL_DELAY_MS = 300 // ms

/** Text column of the header and the editor (same left edge for both). */
const COLUMN = {
  normal: 'px-5 sm:px-[max(64px,calc(50%-350px))]',
  full: 'px-5 sm:px-24',
}

interface WikiPageEditorProps {
  workspaceId: string
  workspaceSlug: string
  userId: string
  userName: string
  userImage?: string | null
  page: WikiPageDTO
}

export function WikiPageEditor({
  workspaceId,
  workspaceSlug,
  userId,
  userName,
  userImage = null,
  page: initialPage,
}: WikiPageEditorProps) {
  const pages = useWikiPages(workspaceId)
  // Mutations (publish, lock, favorite…) replace the page in the list cache;
  // the server-rendered prop is the fallback until the list loads.
  const page =
    pages.data?.find((candidate) => candidate.id === initialPage.id) ??
    initialPage
  const updateWikiPage = useUpdateWikiPage(workspaceId, page.id)
  const ai = useWikiAi(workspaceId, page.id)
  const { data: labels = [] } = useWikiLabels(workspaceId)
  const shortcuts = useShortcuts()
  const [preferences, setPreferences] = useWikiPreferences()
  const [title, setTitle] = useState(page.title)
  const [status, setStatus] = useState<WikiSyncStatus>('connecting')
  const [presence, setPresence] = useState<WikiPresenceUser[]>([])
  const [panelValue, setPanelValue] = useState<Value>(initialPage.content)
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null)
  const contentRef = useRef<Value>(initialPage.content)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const panelTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const editorRef = useRef<PlateEditor | null>(null)

  const locked = Boolean(page.lockedAt)
  const readOnly = locked && !(page.canManageLock ?? false)
  const column = preferences.fullWidth ? COLUMN.full : COLUMN.normal

  // `E`: put the cursor in the page body.
  useShortcut('wiki.focus-editor', () => {
    const editor = document.querySelector<HTMLElement>('[data-slate-editor]')
    if (!editor) return false
    editor.focus()
  })

  useEffect(() => {
    setTitle(initialPage.title)
    contentRef.current = initialPage.content
    setPanelValue(initialPage.content)
  }, [initialPage.id, initialPage.title, initialPage.content])

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
      if (panelTimeoutRef.current) clearTimeout(panelTimeoutRef.current)
    }
  }, [])

  function scheduleContentSave(content: Value) {
    contentRef.current = content
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = setTimeout(() => {
      updateWikiPage.mutate({ content: contentRef.current })
    }, AUTOSAVE_DELAY_MS)
    if (panelTimeoutRef.current) clearTimeout(panelTimeoutRef.current)
    panelTimeoutRef.current = setTimeout(() => {
      setPanelValue(contentRef.current)
    }, PANEL_DELAY_MS)
  }

  function commitTitle(next = title) {
    if (next !== page.title) updateWikiPage.mutate({ title: next })
  }

  const onPresenceChange = useCallback(
    (states: Record<string, unknown>[]) =>
      setPresence(presenceFromAwareness(states)),
    [],
  )

  const runAi = useCallback(
    async (action: WikiAiAction, text: string) =>
      (await ai.mutateAsync({ action, text })).text,
    [ai.mutateAsync],
  )

  const blockAi = useMemo<WikiBlockAiContextValue>(
    () => ({
      run: runAi,
      onUseAsTitle: (text) => {
        const next = text.replace(/^#+\s*/, '').trim()
        setTitle(next)
        if (next !== page.title) updateWikiPage.mutate({ title: next })
      },
    }),
    [runAi, page.title, updateWikiPage.mutate],
  )

  function exportPage(kind: WikiExportKind) {
    const editor = editorRef.current
    if (!editor) return
    createEditorExporter(editor)
      [kind]()
      .catch(() => notify.error('Não foi possível exportar a página'))
  }

  function togglePanel() {
    setPreferences({ panelOpen: !preferences.panelOpen })
  }

  const ancestors = wikiAncestors(pages.data ?? [], page.id)
  const showToolbar = preferences.fixedToolbar

  return (
    <div className='flex h-full min-h-0 w-full flex-col'>
      <WikiPageTopBar
        workspaceId={workspaceId}
        workspaceSlug={workspaceSlug}
        page={page}
        title={title}
        ancestors={ancestors}
        status={status}
        presence={presence}
        userId={userId}
        readOnly={readOnly}
        fullWidth={preferences.fullWidth}
        onFullWidthChange={(fullWidth) => setPreferences({ fullWidth })}
        fixedToolbar={preferences.fixedToolbar}
        onFixedToolbarChange={(fixedToolbar) =>
          setPreferences({ fixedToolbar })
        }
        panelToggle={
          showToolbar
            ? undefined
            : { open: preferences.panelOpen, onToggle: togglePanel }
        }
        onToggleNavigation={() => shortcuts?.trigger('nav.toggle-sidebar')}
        getMarkdown={() =>
          editorRef.current ? editorMarkdown(editorRef.current) : null
        }
        onExport={exportPage}
      />

      <div className='flex min-h-0 flex-1'>
        {/* One scroller for the whole page: the toolbar sticks to its top
            while the header and the text scroll under it. */}
        <div
          ref={setScroller}
          data-wiki-scroller
          className='min-h-0 min-w-0 flex-1 overflow-y-auto'
        >
          <WikiBlockAiContext.Provider value={blockAi}>
            <WikiPageRichEditor
              key={page.id}
              documentName={page.id}
              workspaceId={workspaceId}
              userId={userId}
              userName={userName}
              userImage={userImage}
              content={initialPage.content}
              onChange={scheduleContentSave}
              onStatusChange={setStatus}
              onPresenceChange={onPresenceChange}
              editorRef={editorRef}
              blockGutter={readOnly ? undefined : WikiBlockAiSlot}
              readOnly={readOnly}
              editorClassName={column}
              toolbar={
                showToolbar ? (
                  <WikiToolbar
                    readOnly={readOnly}
                    panelOpen={preferences.panelOpen}
                    onTogglePanel={togglePanel}
                    summarize={(markdown) => runAi('summarize', markdown)}
                  />
                ) : undefined
              }
              header={
                <WikiPageHeader
                  workspaceId={workspaceId}
                  workspaceSlug={workspaceSlug}
                  wikiPageId={page.id}
                  icon={page.icon}
                  title={title}
                  labelIds={page.labelIds}
                  readOnly={readOnly}
                  columnClassName={column}
                  onTitleChange={setTitle}
                  onTitleCommit={() => commitTitle()}
                  onIconChange={(icon) =>
                    updateWikiPage.mutate({ icon }, { onError: notify.error })
                  }
                />
              }
            />
          </WikiBlockAiContext.Provider>
        </div>

        <WikiSidePanel
          open={preferences.panelOpen}
          onOpenChange={(panelOpen) => setPreferences({ panelOpen })}
          tab={preferences.panelTab}
          onTabChange={(panelTab) => setPreferences({ panelTab })}
          value={panelValue}
          page={page}
          labels={labels}
          scroller={scroller}
        />
      </div>
    </div>
  )
}
