'use client'

import { SidebarRightIcon } from '@hugeicons-pro/core-stroke-rounded'
import type { Alignment } from '@platejs/basic-styles'
import { TextAlignPlugin } from '@platejs/basic-styles/react'
import {
  AlignCenterIcon,
  AlignLeftIcon,
  AlignRightIcon,
  Baseline,
  Bold,
  FileCodeIcon,
  Italic,
  PaintBucket,
  QuoteIcon,
  Strikethrough,
  Underline,
} from 'lucide-react'
import { KEYS, type TElement } from 'platejs'
import {
  useEditorPlugin,
  useEditorRef,
  useSelectionFragmentProp,
} from 'platejs/react'
import { getBlockType, setBlockType } from '@/components/editor/transforms'
import { FontColorToolbarButton } from '@/components/editor/ui/font-color-toolbar-button'
import {
  BulletedListToolbarButton,
  NumberedListToolbarButton,
  TodoListToolbarButton,
} from '@/components/editor/ui/list-toolbar-button'
import { MarkToolbarButton } from '@/components/editor/ui/mark-toolbar-button'
import { MediaToolbarButton } from '@/components/editor/ui/media-toolbar-button'
import { TableToolbarButton } from '@/components/editor/ui/table-toolbar-button'
import {
  Toolbar,
  ToolbarButton,
  ToolbarGroup,
} from '@/components/editor/ui/toolbar'
import { TurnIntoToolbarButton } from '@/components/editor/ui/turn-into-toolbar-button'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { WikiAiSummaryButton } from './wiki-ai-summary'
import { editorMarkdown, markdownToBlocks } from './wiki-markdown'

const ALIGNMENTS: {
  value: Alignment
  label: string
  icon: typeof AlignLeftIcon
}[] = [
  { value: 'left', label: 'Alinhar à esquerda', icon: AlignLeftIcon },
  { value: 'center', label: 'Centralizar', icon: AlignCenterIcon },
  { value: 'right', label: 'Alinhar à direita', icon: AlignRightIcon },
]

function AlignButtons() {
  const { editor, tf } = useEditorPlugin(TextAlignPlugin)
  const value =
    useSelectionFragmentProp({
      defaultValue: 'left',
      getProp: (node) => node.align,
    }) ?? 'left'

  return ALIGNMENTS.map(({ value: align, label, icon: Icon }) => (
    <ToolbarButton
      key={align}
      tooltip={label}
      aria-label={label}
      pressed={value === align || (align === 'left' && value === 'start')}
      onClick={() => {
        tf.textAlign.setNodes(align)
        editor.tf.focus()
      }}
    >
      <Icon />
    </ToolbarButton>
  ))
}

function BlockToggleButton({
  type,
  label,
  children,
}: {
  type: string
  label: string
  children: React.ReactNode
}) {
  const editor = useEditorRef()
  const current = useSelectionFragmentProp({
    defaultValue: KEYS.p,
    getProp: (node) => getBlockType(node as TElement),
  })
  const active = current === type

  return (
    <ToolbarButton
      tooltip={label}
      aria-label={label}
      pressed={active}
      onClick={() => {
        setBlockType(editor, active ? KEYS.p : type)
        editor.tf.focus()
      }}
    >
      {children}
    </ToolbarButton>
  )
}

/**
 * The wiki's own fixed toolbar (the knowledge base keeps the shared
 * `FixedToolbarButtons`): block type | colors | marks | alignment | lists |
 * quote and code | table, image, file — then "Resumo com IA" and the side
 * panel toggle. Sticks to the top of the page's scroller.
 */
export function WikiToolbar({
  readOnly,
  panelOpen,
  onTogglePanel,
  summarize,
}: {
  readOnly: boolean
  panelOpen: boolean
  onTogglePanel: () => void
  summarize: (markdown: string) => Promise<string>
}) {
  const editor = useEditorRef()

  return (
    <Toolbar
      data-testid='wiki-toolbar'
      className='sticky top-0 z-40 flex w-full items-center gap-1 border-b border-b-border bg-background/95 px-2 py-1 backdrop-blur-sm supports-backdrop-blur:bg-background/60'
    >
      <div
        className={cn(
          'scrollbar-hide min-w-0 flex-1 overflow-x-auto',
          readOnly && 'invisible',
        )}
        aria-hidden={readOnly || undefined}
      >
        {!readOnly && (
          <div className='flex w-max flex-nowrap items-center'>
            <ToolbarGroup>
              <TurnIntoToolbarButton />
            </ToolbarGroup>

            <ToolbarGroup>
              <FontColorToolbarButton nodeType='color' tooltip='Cor do texto'>
                <Baseline />
              </FontColorToolbarButton>
              <FontColorToolbarButton
                nodeType='backgroundColor'
                tooltip='Cor de fundo'
              >
                <PaintBucket />
              </FontColorToolbarButton>
            </ToolbarGroup>

            <ToolbarGroup>
              <MarkToolbarButton
                nodeType='bold'
                tooltip='Negrito'
                command='cmd+B'
              >
                <Bold />
              </MarkToolbarButton>
              <MarkToolbarButton
                nodeType='italic'
                tooltip='Itálico'
                command='cmd+I'
              >
                <Italic />
              </MarkToolbarButton>
              <MarkToolbarButton
                nodeType='underline'
                tooltip='Sublinhado'
                command='cmd+U'
              >
                <Underline />
              </MarkToolbarButton>
              <MarkToolbarButton
                nodeType='strikethrough'
                tooltip='Riscado'
                command='cmd+S'
              >
                <Strikethrough />
              </MarkToolbarButton>
            </ToolbarGroup>

            <ToolbarGroup>
              <AlignButtons />
            </ToolbarGroup>

            <ToolbarGroup>
              <NumberedListToolbarButton />
              <BulletedListToolbarButton />
              <TodoListToolbarButton />
            </ToolbarGroup>

            <ToolbarGroup>
              <BlockToggleButton type={KEYS.blockquote} label='Citação'>
                <QuoteIcon />
              </BlockToggleButton>
              <BlockToggleButton type={KEYS.codeBlock} label='Bloco de código'>
                <FileCodeIcon />
              </BlockToggleButton>
            </ToolbarGroup>

            <ToolbarGroup>
              <TableToolbarButton />
              <MediaToolbarButton nodeType={KEYS.img} />
              <MediaToolbarButton nodeType={KEYS.file} />
            </ToolbarGroup>
          </div>
        )}
      </div>

      <div className='flex shrink-0 items-center gap-1'>
        <WikiAiSummaryButton
          getMarkdown={() => editorMarkdown(editor)}
          summarize={summarize}
          onInsertAtTop={
            readOnly
              ? undefined
              : (text) =>
                  editor.tf.insertNodes(markdownToBlocks(editor, text), {
                    at: [0],
                  })
          }
        />
        <Button
          variant='ghost'
          size='icon-sm'
          aria-label={
            panelOpen ? 'Fechar painel lateral' : 'Abrir painel lateral'
          }
          aria-pressed={panelOpen}
          title={panelOpen ? 'Fechar painel lateral' : 'Abrir painel lateral'}
          onClick={onTogglePanel}
          className={cn(panelOpen && 'bg-accent text-accent-foreground')}
        >
          <SteelIcon icon={SidebarRightIcon} strokeWidth={2} />
        </Button>
      </div>
    </Toolbar>
  )
}
