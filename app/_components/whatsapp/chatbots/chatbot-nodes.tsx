'use client'

import {
  Alert02Icon,
  BotIcon,
  CustomerSupportIcon,
  GitBranchIcon,
  Link01Icon,
  ListViewIcon,
  Message01Icon,
  PlayIcon,
  QuestionIcon,
  SourceCodeIcon,
  Tick02Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import {
  Handle,
  type Node,
  type NodeProps,
  Position,
  useUpdateNodeInternals,
} from '@xyflow/react'
import { createContext, useContext, useEffect } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { cn } from '@/lib/utils'
import {
  NODE_TYPE_LABEL,
  OPERATOR_LABEL,
  type XyNode,
} from '@/src/lib/whatsapp/chatbot/editor-model'
import { nodeHandles } from '@/src/lib/whatsapp/chatbot/validate'
import type {
  ChatbotNode,
  ChatbotNodeType,
} from '@/src/schemas/whatsapp-chatbot.schema'

type IconType = typeof PlayIcon

export const NODE_ICON: Record<ChatbotNodeType, IconType> = {
  start: PlayIcon,
  message: Message01Icon,
  menu: ListViewIcon,
  question: QuestionIcon,
  condition: GitBranchIcon,
  'set-variable': SourceCodeIcon,
  webhook: Link01Icon,
  'handoff-human': CustomerSupportIcon,
  'handoff-ai': BotIcon,
  end: Tick02Icon,
}

export interface ChatbotNodeTraffic {
  entries: number
  exits: number
}

/**
 * Blocks with a problem (from "Verificar") get a destructive ring; `traffic`
 * carries the per-block entries and exits of the last `trafficDays` days.
 */
export const ChatbotCanvasContext = createContext<{
  issueNodeIds: ReadonlySet<string>
  traffic: ReadonlyMap<string, ChatbotNodeTraffic>
  trafficDays: number
}>({ issueNodeIds: new Set(), traffic: new Map(), trafficDays: 30 })

/** "12 entradas · 9 saídas" for the badge, `null` when nothing passed. */
export function describeTraffic(
  traffic: ChatbotNodeTraffic | undefined,
): { entries: string; exits: string } | null {
  if (!traffic || (traffic.entries === 0 && traffic.exits === 0)) return null
  const plural = (count: number, one: string, many: string) =>
    `${count.toLocaleString('pt-BR')} ${count === 1 ? one : many}`
  return {
    entries: plural(traffic.entries, 'entrada', 'entradas'),
    exits: plural(traffic.exits, 'saída', 'saídas'),
  }
}

export type ChatbotXyNode = Node<XyNode['data'], ChatbotNodeType>

interface Output {
  handle: string
  label: string
  muted?: boolean
}

function outputsOf(node: ChatbotNode): Output[] {
  switch (node.type) {
    case 'menu':
      return [
        ...node.data.options.map((option) => ({
          handle: option.id,
          label: option.label,
        })),
        { handle: 'invalid', label: 'Resposta inválida', muted: true },
      ]
    case 'question':
      return [
        { handle: 'next', label: 'Resposta válida' },
        { handle: 'invalid', label: 'Resposta inválida', muted: true },
      ]
    case 'condition':
      return [
        ...node.data.branches.map((branch, index) => ({
          handle: branch.id,
          label: `Se ${index + 1}: ${branch.variable} ${OPERATOR_LABEL[branch.operator]}${
            branch.value ? ` ${branch.value}` : ''
          }`,
        })),
        { handle: 'else', label: 'Senão', muted: true },
      ]
    case 'webhook':
      return [
        { handle: 'next', label: 'Sucesso' },
        { handle: 'error', label: 'Se der erro', muted: true },
      ]
    default:
      return []
  }
}

function previewOf(node: ChatbotNode): string | null {
  switch (node.type) {
    case 'start':
      return 'O fluxo começa aqui'
    case 'message':
    case 'menu':
    case 'question':
      return node.data.text
    case 'set-variable':
      return `${node.data.variable} = ${node.data.value || '(vazio)'}`
    case 'webhook':
      return `${node.data.method} ${node.data.url}`
    case 'handoff-human':
    case 'end':
      return node.data.text ?? null
    case 'handoff-ai':
      return node.data.text ?? 'A IA assume a conversa'
    case 'condition':
      return null
  }
}

function ChatbotNodeView({
  id,
  type,
  data,
  selected,
}: NodeProps<ChatbotXyNode>) {
  const { issueNodeIds, traffic, trafficDays } =
    useContext(ChatbotCanvasContext)
  const updateInternals = useUpdateNodeInternals()
  const node = { id, type, data, position: { x: 0, y: 0 } } as ChatbotNode
  const handles = nodeHandles(node)
  const outputs = outputsOf(node)
  const handleKey = handles.join('|')
  useEffect(() => {
    updateInternals(id)
  }, [id, handleKey, updateInternals])

  const preview = previewOf(node)
  const single = outputs.length === 0 && handles.length === 1
  const hasIssue = issueNodeIds.has(id)
  const counts = describeTraffic(traffic.get(id))

  return (
    <div
      className={cn(
        'relative w-[250px] rounded-xl border bg-card p-3 text-card-foreground shadow-sm transition-all',
        selected && 'border-primary ring-2 ring-primary/30',
        hasIssue && 'border-destructive ring-2 ring-destructive/30',
      )}
    >
      {type !== 'start' ? (
        <Handle
          type='target'
          position={Position.Left}
          className='!size-2.5 !border-2 !border-background !bg-primary'
        />
      ) : null}

      <div className='flex items-center gap-2'>
        <div className='grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-primary'>
          <SteelIcon icon={NODE_ICON[type]} strokeWidth={2} size={16} />
        </div>
        <div className='min-w-0 flex-1 font-semibold text-sm'>
          {NODE_TYPE_LABEL[type]}
        </div>
        {hasIssue ? (
          <SteelIcon
            icon={Alert02Icon}
            strokeWidth={2}
            size={16}
            className='text-destructive'
          />
        ) : null}
      </div>

      {preview ? (
        <p className='mt-2 line-clamp-3 whitespace-pre-line break-words text-muted-foreground text-xs'>
          {preview}
        </p>
      ) : null}

      {counts ? (
        <p
          className='mt-2 flex items-center gap-2 border-t pt-2 text-[11px] text-muted-foreground tabular-nums'
          title={`Últimos ${trafficDays} dias: quantas vezes uma conversa chegou a este bloco e quantas seguiram adiante.`}
          data-testid='chatbot-node-traffic'
        >
          <span>{counts.entries}</span>
          <span aria-hidden>·</span>
          <span>{counts.exits}</span>
        </p>
      ) : null}

      {single ? (
        <Handle
          type='source'
          id='next'
          position={Position.Right}
          className='!size-2.5 !border-2 !border-background !bg-primary'
        />
      ) : null}

      {outputs.length > 0 ? (
        <div className='mt-2 space-y-1 border-t pt-2'>
          {outputs.map((output) => (
            <div
              key={output.handle}
              className={cn(
                'relative truncate pr-3 text-xs',
                output.muted ? 'text-muted-foreground' : 'font-medium',
              )}
            >
              {output.label}
              <Handle
                type='source'
                id={output.handle}
                position={Position.Right}
                className={cn(
                  '!size-2.5 !border-2 !border-background',
                  output.muted ? '!bg-muted-foreground' : '!bg-primary',
                )}
                style={{ right: -17 }}
              />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export const CHATBOT_NODE_TYPES_MAP = {
  start: ChatbotNodeView,
  message: ChatbotNodeView,
  menu: ChatbotNodeView,
  question: ChatbotNodeView,
  condition: ChatbotNodeView,
  'set-variable': ChatbotNodeView,
  webhook: ChatbotNodeView,
  'handoff-human': ChatbotNodeView,
  'handoff-ai': ChatbotNodeView,
  end: ChatbotNodeView,
}
