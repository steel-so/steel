'use client'

import { Editor, Extension } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import {
  type CSSProperties,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { getIn } from '@/src/lib/canvas/path'
import type { InspectorControl } from '@/src/lib/canvas/registry'
import type { CanvasNodeId } from '@/src/lib/canvas/types'
import { useCanvasEditor } from '../editor-context'
import { elementOf } from '../lib/frame-handle'
import type { InlineMark } from '../lib/inline'
import { useCanvasNode, useCanvasStore } from '../use-canvas'

const COPIED_STYLES = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'lineHeight',
  'letterSpacing',
  'wordSpacing',
  'textTransform',
  'textAlign',
  'textDecoration',
  'color',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
] as const

const BORDERS = ['Top', 'Right', 'Bottom', 'Left'] as const

/** Deepest element that still holds the whole text (a button's `<a>`, a
 * heading's `<h2>`), so the editor copies its font and padding. */
export function textElementOf(element: HTMLElement): HTMLElement {
  let current = element
  for (;;) {
    const ownText = [...current.childNodes].some(
      (child) => child.nodeType === 3 && child.textContent?.trim(),
    )
    if (ownText || current.children.length !== 1) return current
    current = current.children[0] as HTMLElement
  }
}

interface Box {
  style: CSSProperties
  key: string
}

type Typography = Record<string, string | number>

/** Font, color and padding of the rendered text. Read once, before the
 * original text is made transparent (later reads would copy that). */
function readTypography(target: HTMLElement): Typography {
  const view = target.ownerDocument.defaultView as Window
  const computed = view.getComputedStyle(target)
  const style: Typography = {}
  for (const key of COPIED_STYLES) style[key] = computed[key]
  for (const side of BORDERS) {
    style[`border${side}`] =
      `${computed[`border${side}Width`]} solid transparent`
  }
  style.caretColor = computed.color
  // Rich text: paragraphs keep the catalog's spacing.
  const paragraph = target.querySelector('p')
  if (paragraph) {
    const pStyle = view.getComputedStyle(paragraph)
    style['--canvas-p-mt'] = pStyle.marginTop
    style['--canvas-p-mb'] = pStyle.marginBottom
  }
  return style
}

function measure(element: HTMLElement, typography: Typography): Box {
  const rect = textElementOf(element).getBoundingClientRect()
  const style: Record<string, string | number> = {
    position: 'absolute',
    left: rect.left,
    top: rect.top,
    width: rect.width,
    minHeight: rect.height,
    boxSizing: 'border-box',
    zIndex: 2147483000,
    background: 'transparent',
    margin: 0,
    ...typography,
  }
  return { style, key: JSON.stringify(style) }
}

function escapeCss(id: string) {
  return id.replace(/["\\]/g, '\\$&')
}

/** Marks allowed in the floating toolbar: from the inspector's richtext
 * control on the same path, else all of them. */
export function inlineMarks(
  control: InspectorControl | undefined,
): InlineMark[] {
  const all: InlineMark[] = [
    'bold',
    'italic',
    'underline',
    'strike',
    'link',
    'list',
  ]
  if (control?.kind !== 'richtext' || !control.marks) return all
  return all.filter((mark) => control.marks?.includes(mark))
}

/**
 * Edits a node's `inlineText` prop in place (double-click on the canvas):
 * a TipTap editor laid exactly over the rendered text, with the original
 * text made transparent underneath. Every change is dispatched (coalesced)
 * so the real component keeps the same size as the editor.
 */
export function InlineTextEditor({ id }: { id: CanvasNodeId }) {
  const { store, catalog, frame } = useCanvasEditor()
  const hostRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<Box | null>(null)
  const typography = useRef<Typography | null>(null)
  const selected = useCanvasStore((state) => state.selection.includes(id))
  const node = useCanvasNode(id) ?? null
  const definition = node ? catalog.components[node.type] : undefined
  const inline = definition?.inlineText

  // Leave inline editing when the node is deselected or removed.
  useEffect(() => {
    if (!selected || !node || !inline) store.setEditingText(null)
  }, [selected, node, inline, store])

  // Follow the rendered element (typing grows it, the stage may resize).
  const follow = () => {
    const element = elementOf(frame, id)
    if (!element) return
    typography.current ??= readTypography(textElementOf(element))
    const next = measure(element, typography.current)
    setBox((prev) => (prev?.key === next.key ? prev : next))
  }
  useLayoutEffect(follow)
  useEffect(() => frame.subscribe(follow), [frame, id])

  // Hide the original text while the editor sits on top of it.
  useLayoutEffect(() => {
    const frameDoc = frame.document
    if (!frameDoc) return
    const style = frameDoc.createElement('style')
    const selector = `[data-canvas-id="${escapeCss(id)}"]`
    style.textContent = `${selector},${selector} *{color:transparent!important;-webkit-text-fill-color:transparent!important}`
    frameDoc.head.appendChild(style)
    return () => style.remove()
  }, [frame, id])

  useEffect(() => {
    const host = hostRef.current
    if (!host || !inline || !node || !definition) return
    const rich = inline.rich
    const field = definition.inspector
      .flatMap((section) => section.fields)
      .find((candidate) => candidate.path === inline.path)
    const raw = getIn(node.props, inline.path)
    const initial = typeof raw === 'string' ? raw : ''
    const finish = () => {
      store.setEditingText(null)
      return true
    }
    const keys = Extension.create({
      name: 'canvasInlineKeys',
      addKeyboardShortcuts: () => ({
        Escape: finish,
        ...(rich ? {} : { Enter: finish }),
      }),
    })
    const editor = new Editor({
      element: host,
      injectCSS: false,
      extensions: [
        rich
          ? StarterKit.configure({
              heading: false,
              codeBlock: false,
              code: false,
              blockquote: false,
              horizontalRule: false,
              link: { openOnClick: false, autolink: true },
            })
          : StarterKit.configure({
              heading: false,
              codeBlock: false,
              code: false,
              blockquote: false,
              horizontalRule: false,
              bulletList: false,
              orderedList: false,
              listItem: false,
              listKeymap: false,
              bold: false,
              italic: false,
              strike: false,
              underline: false,
              link: false,
            }),
        keys,
      ],
      content: rich
        ? initial
        : {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: initial ? [{ type: 'text', text: initial }] : [],
              },
            ],
          },
      onUpdate: ({ editor: current }) => {
        const value = rich
          ? current.isEmpty
            ? ''
            : current.getHTML()
          : current.getText({ blockSeparator: ' ' })
        store.dispatch(
          { kind: 'update', id, set: { [inline.path]: value } },
          { coalesce: true, label: 'text' },
        )
      },
    })
    editor.commands.focus('end')
    frame.inline = {
      editor,
      rich,
      marks: rich ? inlineMarks(field?.control) : [],
    }
    frame.notify()
    return () => {
      frame.inline = null
      editor.destroy()
      frame.notify()
    }
  }, [id])

  return (
    <div
      ref={hostRef}
      data-canvas-inline=''
      data-plain={inline?.rich ? undefined : ''}
      data-testid='canvas-inline-editor'
      style={box?.style ?? { position: 'absolute', opacity: 0 }}
    />
  )
}
