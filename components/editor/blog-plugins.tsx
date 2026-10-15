'use client'

import { Bold, Code2, Italic, Strikethrough, Underline } from 'lucide-react'
import {
  createPlatePlugin,
  PlateElement,
  type PlateElementProps,
} from 'platejs/react'
import { FloatingToolbar } from '@/components/editor/ui/floating-toolbar'
import { LinkToolbarButton } from '@/components/editor/ui/link-toolbar-button'
import { MarkToolbarButton } from '@/components/editor/ui/mark-toolbar-button'
import { ToolbarGroup } from '@/components/editor/ui/toolbar'
import { TurnIntoToolbarButton } from '@/components/editor/ui/turn-into-toolbar-button'
import { cn } from '@/lib/utils'
import { AlignKit } from './plugins/align-kit'
import { BasicNodesKit } from './plugins/basic-nodes-kit'
import { BlockMenuKit } from './plugins/block-menu-kit'
import { CodeBlockKit } from './plugins/code-block-kit'
import { ColumnKit } from './plugins/column-kit'
import { DndKit } from './plugins/dnd-kit'
import { EmojiKit } from './plugins/emoji-kit'
import { LinkKit } from './plugins/link-kit'
import { ListKit } from './plugins/list-kit'
import { MarkdownKit } from './plugins/markdown-kit'
import { MathKit } from './plugins/math-kit'
import { MediaKit } from './plugins/media-kit'
import { SlashKit } from './plugins/slash-kit'
import { TableKit } from './plugins/table-kit'
import { TocKit } from './plugins/toc-kit'
import { ToggleKit } from './plugins/toggle-kit'

/**
 * Plate editor of site blog posts: the knowledge base's content kits that
 * the public site renders (headings, lists, code, tables, columns, media,
 * embeds, links, table of contents, equations) plus a callout block. No
 * comments, mentions, font colors or sizes: a post follows the site's
 * theme, and the published HTML is built from these nodes only
 * (`src/lib/sites/blog/plate.ts`).
 */

export const CALLOUT_KEY = 'callout'

const CALLOUT_TONE: Record<string, string> = {
  info: 'border-primary bg-primary/5',
  warning: 'border-highlight bg-highlight/20',
  success: 'border-chart-2 bg-chart-2/10',
  error: 'border-destructive bg-destructive/10',
}

export function CalloutElement(props: PlateElementProps) {
  const variant = (props.element as { variant?: string }).variant ?? 'info'
  return (
    <PlateElement
      {...props}
      className={cn(
        'my-2 rounded-md border-l-4 px-4 py-3',
        CALLOUT_TONE[variant] ?? CALLOUT_TONE.info,
      )}
    />
  )
}

export const CalloutKit = [
  createPlatePlugin({
    key: CALLOUT_KEY,
    node: { isElement: true, component: CalloutElement },
  }),
]

function BlogFloatingToolbarButtons() {
  return (
    <>
      <ToolbarGroup>
        <TurnIntoToolbarButton />
      </ToolbarGroup>
      <ToolbarGroup>
        <MarkToolbarButton nodeType='bold' tooltip='Negrito'>
          <Bold />
        </MarkToolbarButton>
        <MarkToolbarButton nodeType='italic' tooltip='Itálico'>
          <Italic />
        </MarkToolbarButton>
        <MarkToolbarButton nodeType='underline' tooltip='Sublinhado'>
          <Underline />
        </MarkToolbarButton>
        <MarkToolbarButton nodeType='strikethrough' tooltip='Riscado'>
          <Strikethrough />
        </MarkToolbarButton>
        <MarkToolbarButton nodeType='code' tooltip='Código'>
          <Code2 />
        </MarkToolbarButton>
        <LinkToolbarButton />
      </ToolbarGroup>
    </>
  )
}

const BlogFloatingToolbarKit = [
  createPlatePlugin({
    key: 'floating-toolbar',
    render: {
      afterEditable: () => (
        <FloatingToolbar>
          <BlogFloatingToolbarButtons />
        </FloatingToolbar>
      ),
    },
  }),
]

export const BLOG_EDITOR_PLUGINS = [
  ...BasicNodesKit,
  ...ListKit,
  ...CodeBlockKit,
  ...ColumnKit,
  ...ToggleKit,
  ...TocKit,
  ...MediaKit,
  ...LinkKit,
  ...MathKit,
  ...EmojiKit,
  ...TableKit,
  ...AlignKit,
  ...CalloutKit,
  ...SlashKit,
  ...MarkdownKit,
  ...BlockMenuKit,
  ...DndKit,
  ...BlogFloatingToolbarKit,
]
