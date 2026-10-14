'use client'

import { type ReactNode, type RefObject, useEffect, useState } from "react"
import { KEYS, Value } from "platejs"
import { type PlateEditor, Plate, usePlateEditor } from "platejs/react"
import { YjsPlugin } from "@platejs/yjs/react"
import { BasicNodesKit } from "./plugins/basic-nodes-kit"
import { ListKit } from "./plugins/list-kit"
import { CodeBlockKit } from "./plugins/code-block-kit"
import { AlignKit } from "./plugins/align-kit"
import { FontKit } from "./plugins/font-kit"
import { LineHeightKit } from "./plugins/line-height-kit"
import { BlockMenuKit } from "./plugins/block-menu-kit"
import { FloatingToolbarKit } from "./plugins/floating-toolbar-kit"
import { CursorOverlayKit } from "./plugins/cursor-overlay-kit"
import { createYjsKit } from "./plugins/yjs-kit"
import { useMounted } from "@/components/editor/hooks/use-mounted"
import { cn } from "@/lib/utils"
import { Editor, EditorContainer } from "@/components/editor/ui/editor"
import { CursorOverlay } from "@/components/editor/ui/cursor-overlay"
import {
  type BlockGutterSlot,
  BlockGutterSlotContext,
} from "@/components/editor/ui/block-draggable"
import { ColumnKit } from "./plugins/column-kit"
import { ToggleKit } from "./plugins/toggle-kit"
import { TocKit } from "./plugins/toc-kit"
import { MediaKit } from "./plugins/media-kit"
import { DndKit } from "./plugins/dnd-kit"
import { LinkKit } from "./plugins/link-kit"
import { DateKit } from "./plugins/date-kit"
import { MathKit } from "./plugins/math-kit"
import { EmojiKit } from "./plugins/emoji-kit"
import { MentionKit } from "./plugins/mention-kit"
import { SlashKit } from "./plugins/slash-kit"
import { TableKit } from "./plugins/table-kit"
import { CodeDrawingKit } from "./plugins/code-drawing-kit"
import { ExcalidrawKit } from "./plugins/excalidraw-kit"
import { FootnoteKit } from "./plugins/footnote-kit"
import { MarkdownKit } from "./plugins/markdown-kit"
import { DocxKit } from "./plugins/docx-kit"
import { CommentKit } from "./plugins/comment-kit"
import { DiscussionKit } from "./plugins/discussion-kit"
import { wikiEditorBackend } from "@/src/hooks/wiki-editor-backend"
import { EditorDocumentProvider } from "./editor-document-context"
import {
  type WikiSyncStatus,
  wikiSyncStatus,
} from "@/src/lib/wiki-sync-status"

export type { WikiSyncStatus }

// Deterministic color per user — same userId, same remote cursor always.
function colorFromUserId(userId: string): string {
  let hash = 0
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash)
  }
  return `hsl(${hash % 360}, 70%, 50%)`
}

interface WikiPageRichEditorProps {
  documentName: string
  workspaceId: string
  userId: string
  userName: string
  /** Avatar shown to the others on the page (Yjs awareness). */
  userImage?: string | null
  content: Value
  onChange: (content: Value) => void
  /** The page's toolbar, inside the editor's Plate context (sticky). */
  toolbar?: ReactNode
  /** Rendered between the toolbar and the text (icon, title, labels). */
  header?: ReactNode
  onStatusChange?: (status: WikiSyncStatus) => void
  /** Raw awareness states of everyone on the page, on every change. */
  onPresenceChange?: (states: Record<string, unknown>[]) => void
  /** Filled with the editor, for actions outside the Plate tree. */
  editorRef?: RefObject<PlateEditor | null>
  /** Extra control beside each block's drag handle (inline AI). */
  blockGutter?: BlockGutterSlot
  readOnly?: boolean
  /** Classes of the editable area (the text column's padding). */
  editorClassName?: string
  className?: string
}

export function WikiPageRichEditor({
  documentName,
  workspaceId,
  userId,
  userName,
  userImage,
  content,
  onChange,
  toolbar,
  header,
  onStatusChange,
  onPresenceChange,
  editorRef,
  blockGutter,
  readOnly = false,
  editorClassName,
  className
}: WikiPageRichEditorProps) {
  const [isSynced, setIsSynced] = useState(false)
  const [connected, setConnected] = useState<boolean | null>(null)
  const status = wikiSyncStatus(isSynced, connected)

  useEffect(() => {
    onStatusChange?.(status)
  }, [status, onStatusChange])

  const editor = usePlateEditor({
    plugins: [
      ...BasicNodesKit,
      ...ListKit,
      ...CodeBlockKit,
      ...ColumnKit,
      ...ToggleKit,
      ...TocKit,
      ...MediaKit,
      ...LinkKit,
      ...DateKit,
      ...MathKit,
      ...EmojiKit,
      ...MentionKit,
      ...SlashKit,
      ...TableKit,
      ...CodeDrawingKit,
      ...ExcalidrawKit,
      ...FootnoteKit,
      ...MarkdownKit,
      ...DocxKit,
      ...CommentKit,
      ...DiscussionKit,
      ...AlignKit,
      ...FontKit,
      ...LineHeightKit,
      ...CursorOverlayKit,
      ...BlockMenuKit,
      ...DndKit,
      ...FloatingToolbarKit,
      ...createYjsKit({
        documentName,
        userId,
        userName,
        userImage,
        userColor: colorFromUserId(userId),
        onSyncChange: setIsSynced,
        onConnectionChange: setConnected,
      }),
    ],
    value: content,
    skipInitialization: true,
  })

  const mounted = useMounted()

  useEffect(() => {
    if (!editorRef) return
    editorRef.current = editor
    return () => {
      editorRef.current = null
    }
  }, [editor, editorRef])

  useEffect(() => {
    if (!onPresenceChange) return
    const awareness = editor.getOption(YjsPlugin, 'awareness')
    if (!awareness) return
    const emit = () =>
      onPresenceChange(
        Array.from(awareness.getStates().values()) as Record<string, unknown>[],
      )
    emit()
    awareness.on('change', emit)
    return () => awareness.off('change', emit)
  }, [editor, onPresenceChange])

  useEffect(() => {
    if (!mounted) return

    let cancelled = false

    // Opening the WebSocket while the page is still loading (fonts,
    // HMR, analytics scripts competing for the connection) makes the browser
    // drop the connection ("interrupted while the page was loading"). Waits
    // for loading to actually finish before connecting.
    function start() {
      if (cancelled) return
      editor.getApi(YjsPlugin).yjs.init({
        id: documentName,
        value: content,
      })
    }

    if (document.readyState === 'complete') {
      start()
    } else {
      window.addEventListener('load', start, { once: true })
    }

    return () => {
      cancelled = true
      window.removeEventListener('load', start)
      editor.getApi(YjsPlugin).yjs.destroy()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, documentName, mounted])

  return (
    <EditorDocumentProvider
      workspaceId={workspaceId}
      documentId={documentName}
      userId={userId}
      userName={userName}
      backend={wikiEditorBackend}
    >
      <BlockGutterSlotContext.Provider value={blockGutter ?? null}>
      <Plate
        editor={editor}
        readOnly={readOnly}
        onChange={({ value }) => {
          // Ctrl+A -> Del can zero out editor.children before Slate's
          // normalization runs (Yjs init disables the default normalization,
          // see yjs.init()). An empty document breaks rendering
          // — never let this propagate to autosave or the rest of the tree.
          if (value.length === 0) {
            editor.tf.insertNodes(editor.api.create.block({ type: KEYS.p }), {
              at: [0],
            })
            return
          }
          onChange(value)
        }}
      >
        <div className={cn('flex flex-col', className)}>
          {toolbar}
          {header}
          {/* The page scrolls as a whole (title, labels, toolbar, text), so
              the container does not scroll on its own: the toolbar then
              sticks to the top of the page's scroller. */}
          <EditorContainer
            // What the browser suite waits on before typing: keystrokes made
            // before the first sync are thrown away by the remount below.
            data-sync-state={isSynced ? 'synced' : 'pending'}
            className='h-auto overflow-visible'
          >
            {/* Forces remounting the editable area as soon as Yjs syncs — the
                editor.tf.init() called internally by yjs.init() doesn't always
                propagate the new editor.children to this tree on its own. */}
            <Editor
              key={isSynced ? 'synced' : 'pending'}
              placeholder='Digite algo, ou / para comandos'
              className={cn('min-h-[50vh] max-sm:px-5 max-sm:pb-40', editorClassName)}
            />
            <CursorOverlay />
          </EditorContainer>
        </div>
      </Plate>
      </BlockGutterSlotContext.Provider>
    </EditorDocumentProvider>
  )
}
