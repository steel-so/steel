'use client'

import type { IconSvgElement } from '@hugeicons/react'
import {
  Heading02Icon,
  LeftToRightListBulletIcon,
  LeftToRightListNumberIcon,
  Link01Icon,
  TextBoldIcon,
  TextItalicIcon,
  TextStrikethroughIcon,
  TextUnderlineIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useEffect, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { cn } from '@/lib/utils'
import { normalizeHref } from '../../frame/inline-toolbar'
import { type ControlProps, inputClass } from './primitives'

type Mark = NonNullable<
  Extract<ControlProps['control'], { kind: 'richtext' }>['marks']
>[number]

const ALL_MARKS: Mark[] = [
  'bold',
  'italic',
  'underline',
  'strike',
  'link',
  'list',
  'heading',
]

function ToolbarButton({
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
        'flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground',
        active && 'bg-primary/10 text-primary',
      )}
    >
      <SteelIcon icon={icon} strokeWidth={2} className='size-4' />
    </button>
  )
}

/** Rich text field (TipTap) with the catalog's allowed marks. Stores HTML;
 * the catalog sanitizes on render. */
export function RichTextControl({
  id,
  label,
  value,
  onChange,
  control,
}: ControlProps<'richtext', string>) {
  const marks = control.marks ?? ALL_MARKS
  const [linking, setLinking] = useState<string | null>(null)
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: marks.includes('heading') ? { levels: [2, 3] } : false,
        bold: marks.includes('bold') ? undefined : false,
        italic: marks.includes('italic') ? undefined : false,
        underline: marks.includes('underline') ? undefined : false,
        strike: marks.includes('strike') ? undefined : false,
        bulletList: marks.includes('list') ? undefined : false,
        orderedList: marks.includes('list') ? undefined : false,
        listItem: marks.includes('list') ? undefined : false,
        listKeymap: marks.includes('list') ? undefined : false,
        link: marks.includes('link')
          ? { openOnClick: false, autolink: true }
          : false,
        codeBlock: false,
        code: false,
        blockquote: false,
        horizontalRule: false,
      }),
    ],
    content: value ?? '',
    editorProps: {
      attributes: {
        id,
        'aria-label': label,
        role: 'textbox',
        'aria-multiline': 'true',
        class:
          'min-h-20 px-2.5 py-2 text-xs leading-relaxed outline-none [&_a]:text-primary [&_a]:underline [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1 [&_ul]:list-disc [&_ul]:pl-5',
      },
    },
    onUpdate: ({ editor: current }) => {
      onChange(current.isEmpty ? '' : current.getHTML())
    },
  })
  const active = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current?.isActive('bold') ?? false,
      italic: current?.isActive('italic') ?? false,
      underline: current?.isActive('underline') ?? false,
      strike: current?.isActive('strike') ?? false,
      link: current?.isActive('link') ?? false,
      bulletList: current?.isActive('bulletList') ?? false,
      orderedList: current?.isActive('orderedList') ?? false,
      heading: current?.isActive('heading') ?? false,
    }),
  })

  // Undo/redo and node switches change the value from outside.
  useEffect(() => {
    if (!editor) return
    const current = editor.isEmpty ? '' : editor.getHTML()
    if (current !== (value ?? '')) {
      editor.commands.setContent(value ?? '', { emitUpdate: false })
    }
  }, [editor, value])

  const applyLink = () => {
    if (!editor) return
    const href = normalizeHref(linking ?? '')
    const chain = editor.chain().focus().extendMarkRange('link')
    if (href) chain.setLink({ href }).run()
    else chain.unsetLink().run()
    setLinking(null)
  }

  return (
    <div className='overflow-hidden rounded-md border border-input bg-background shadow-xs focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30 dark:bg-input/30'>
      <div className='flex flex-wrap items-center gap-0.5 border-b bg-muted/40 px-1 py-1'>
        {linking !== null ? (
          <form
            className='flex w-full items-center gap-1'
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
              onKeyDown={(event) => event.key === 'Escape' && setLinking(null)}
              className={cn(inputClass, 'h-7')}
            />
            <button
              type='submit'
              className='h-7 shrink-0 rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground'
            >
              Aplicar
            </button>
          </form>
        ) : (
          <>
            {marks.includes('heading') && (
              <ToolbarButton
                label='Título'
                icon={Heading02Icon}
                active={active?.heading}
                onClick={() =>
                  editor?.chain().focus().toggleHeading({ level: 2 }).run()
                }
              />
            )}
            {marks.includes('bold') && (
              <ToolbarButton
                label='Negrito'
                icon={TextBoldIcon}
                active={active?.bold}
                onClick={() => editor?.chain().focus().toggleBold().run()}
              />
            )}
            {marks.includes('italic') && (
              <ToolbarButton
                label='Itálico'
                icon={TextItalicIcon}
                active={active?.italic}
                onClick={() => editor?.chain().focus().toggleItalic().run()}
              />
            )}
            {marks.includes('underline') && (
              <ToolbarButton
                label='Sublinhado'
                icon={TextUnderlineIcon}
                active={active?.underline}
                onClick={() => editor?.chain().focus().toggleUnderline().run()}
              />
            )}
            {marks.includes('strike') && (
              <ToolbarButton
                label='Tachado'
                icon={TextStrikethroughIcon}
                active={active?.strike}
                onClick={() => editor?.chain().focus().toggleStrike().run()}
              />
            )}
            {marks.includes('link') && (
              <ToolbarButton
                label={active?.link ? 'Remover link' : 'Link'}
                icon={Link01Icon}
                active={active?.link}
                onClick={() =>
                  active?.link
                    ? editor
                        ?.chain()
                        .focus()
                        .extendMarkRange('link')
                        .unsetLink()
                        .run()
                    : setLinking('')
                }
              />
            )}
            {marks.includes('list') && (
              <>
                <ToolbarButton
                  label='Lista'
                  icon={LeftToRightListBulletIcon}
                  active={active?.bulletList}
                  onClick={() =>
                    editor?.chain().focus().toggleBulletList().run()
                  }
                />
                <ToolbarButton
                  label='Lista numerada'
                  icon={LeftToRightListNumberIcon}
                  active={active?.orderedList}
                  onClick={() =>
                    editor?.chain().focus().toggleOrderedList().run()
                  }
                />
              </>
            )}
          </>
        )}
      </div>
      <EditorContent editor={editor} />
    </div>
  )
}
