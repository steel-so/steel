'use client'

import type { IconSvgElement } from '@hugeicons/react'
import {
  Cancel01Icon,
  LeftToRightListBulletIcon,
  LeftToRightListNumberIcon,
  Link01Icon,
  TextBoldIcon,
  TextItalicIcon,
  TextStrikethroughIcon,
  TextUnderlineIcon,
  Tick02Icon,
  Unlink01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import type { Editor } from '@tiptap/core'
import { useEffect, useLayoutEffect, useReducer, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { cn } from '@/lib/utils'
import { useCanvasEditor, useFrameVersion } from '../editor-context'
import type { Rect } from '../lib/drop-target'
import { frameRectOf } from '../lib/frame-handle'
import { useCanvasStore } from '../use-canvas'

function ToolButton({
  label,
  icon,
  active,
  onClick,
}: {
  label: string
  icon: IconSvgElement
  active?: boolean
  onClick: () => void
}) {
  return (
    <button
      type='button'
      aria-label={label}
      title={label}
      aria-pressed={active}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn(
        'flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
        active &&
          'bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary',
      )}
    >
      <SteelIcon icon={icon} strokeWidth={2} className='size-4' />
    </button>
  )
}

/** Re-renders on every editor transaction (active marks). */
function useEditorTick(editor: Editor | null) {
  const [, tick] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    if (!editor) return
    editor.on('transaction', tick)
    return () => {
      editor.off('transaction', tick)
    }
  }, [editor])
}

/** Normalizes a typed link ("site.com" → "https://site.com"). */
export function normalizeHref(value: string): string {
  const href = value.trim()
  if (!href) return ''
  if (/^(https?:|mailto:|tel:|#|\/|\{\{)/i.test(href)) return href
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(href)) return `mailto:${href}`
  return `https://${href}`
}

/**
 * Floating toolbar for the inline text editor, in the parent document right
 * above the edited text. Buttons never take focus away from the editor.
 */
export function InlineToolbar() {
  const { frame } = useCanvasEditor()
  useFrameVersion()
  const editingId = useCanvasStore((state) => state.editingText)
  const inline = editingId ? frame.inline : null
  const editor = inline?.editor ?? null
  useEditorTick(editor)
  const doc = useCanvasStore((state) => state.doc)
  const [rect, setRect] = useState<Rect | null>(null)
  const [linking, setLinking] = useState<string | null>(null)

  useLayoutEffect(() => {
    setRect(editingId ? frameRectOf(frame, editingId) : null)
  }, [editingId, frame, doc, frame.version])

  useEffect(() => setLinking(null), [editingId])

  if (!editingId || !rect) return null
  const scale = frame.scale
  const top = rect.y * scale
  const style = {
    left: rect.x * scale,
    top: top > 48 ? top - 44 : (rect.y + rect.height) * scale + 8,
  }

  if (!inline?.rich || !editor) {
    return (
      <div
        className='pointer-events-none absolute flex h-7 items-center rounded-md bg-foreground/90 px-2 text-[11px] font-medium whitespace-nowrap text-background shadow-md'
        style={style}
      >
        Editando texto · Enter ou Esc para concluir
      </div>
    )
  }

  const marks = inline.marks
  const applyLink = () => {
    const href = normalizeHref(linking ?? '')
    const chain = editor.chain().focus().extendMarkRange('link')
    if (href) chain.setLink({ href }).run()
    else chain.unsetLink().run()
    setLinking(null)
  }

  return (
    <div
      data-testid='canvas-inline-toolbar'
      role='toolbar'
      aria-label='Formatação do texto'
      className='pointer-events-auto absolute flex h-9 items-center gap-0.5 rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg'
      style={style}
    >
      {linking !== null ? (
        <form
          className='flex items-center gap-1'
          onSubmit={(event) => {
            event.preventDefault()
            applyLink()
          }}
        >
          <input
            autoFocus
            aria-label='Endereço do link'
            placeholder='https://… ou e-mail'
            value={linking}
            onChange={(event) => setLinking(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setLinking(null)
            }}
            className='h-7 w-56 rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/40'
          />
          <ToolButton
            label='Aplicar link'
            icon={Tick02Icon}
            onClick={applyLink}
          />
          <ToolButton
            label='Cancelar'
            icon={Cancel01Icon}
            onClick={() => setLinking(null)}
          />
        </form>
      ) : (
        <>
          {marks.includes('bold') && (
            <ToolButton
              label='Negrito'
              icon={TextBoldIcon}
              active={editor.isActive('bold')}
              onClick={() => editor.chain().focus().toggleBold().run()}
            />
          )}
          {marks.includes('italic') && (
            <ToolButton
              label='Itálico'
              icon={TextItalicIcon}
              active={editor.isActive('italic')}
              onClick={() => editor.chain().focus().toggleItalic().run()}
            />
          )}
          {marks.includes('underline') && (
            <ToolButton
              label='Sublinhado'
              icon={TextUnderlineIcon}
              active={editor.isActive('underline')}
              onClick={() => editor.chain().focus().toggleUnderline().run()}
            />
          )}
          {marks.includes('strike') && (
            <ToolButton
              label='Tachado'
              icon={TextStrikethroughIcon}
              active={editor.isActive('strike')}
              onClick={() => editor.chain().focus().toggleStrike().run()}
            />
          )}
          {marks.includes('link') &&
            (editor.isActive('link') ? (
              <ToolButton
                label='Remover link'
                icon={Unlink01Icon}
                active
                onClick={() =>
                  editor
                    .chain()
                    .focus()
                    .extendMarkRange('link')
                    .unsetLink()
                    .run()
                }
              />
            ) : (
              <ToolButton
                label='Link'
                icon={Link01Icon}
                onClick={() => setLinking('')}
              />
            ))}
          {marks.includes('list') && (
            <>
              <span className='mx-0.5 h-4 w-px bg-border' />
              <ToolButton
                label='Lista'
                icon={LeftToRightListBulletIcon}
                active={editor.isActive('bulletList')}
                onClick={() => editor.chain().focus().toggleBulletList().run()}
              />
              <ToolButton
                label='Lista numerada'
                icon={LeftToRightListNumberIcon}
                active={editor.isActive('orderedList')}
                onClick={() => editor.chain().focus().toggleOrderedList().run()}
              />
            </>
          )}
        </>
      )}
    </div>
  )
}
