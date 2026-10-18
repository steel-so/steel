'use client'

import { AiMagicIcon } from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import type { SteelAiLiveMessage } from '@/src/lib/steel-ai-stream'
import type {
  AiAttachmentDTO,
  AiMessageDTO,
  AiPendingActionDTO,
  AiToolCallDTO,
} from '@/types/steel-ai'
import { SteelAiMessageAttachments } from './steel-ai-attachments'
import { citationsOf, SteelAiCitations } from './steel-ai-citations'
import { SteelAiExecutedActionCard } from './steel-ai-executed-action-card'
import { SteelAiMarkdown } from './steel-ai-markdown'
import { SteelAiMemoryChip } from './steel-ai-memory-chip'
import { SteelAiPendingActionCard } from './steel-ai-pending-action-card'
import {
  SteelAiSimulatedActionCard,
  SteelAiSimulationSummary,
} from './steel-ai-simulated-action-card'
import { SteelAiToolCall } from './steel-ai-tool-call'

function UserBubble({
  content,
  attachments = [],
  animate,
}: {
  content: string
  attachments?: AiAttachmentDTO[]
  animate?: boolean
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-end gap-2',
        animate &&
          'motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:animate-in motion-safe:duration-300',
      )}
    >
      <SteelAiMessageAttachments
        attachments={attachments}
        className='max-w-[85%] sm:max-w-[75%]'
      />
      {content ? (
        <div className='min-w-0 max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-muted px-3.5 py-2 text-sm leading-relaxed [overflow-wrap:anywhere] sm:max-w-[75%] sm:px-4 sm:py-2.5'>
          {content}
        </div>
      ) : null}
    </div>
  )
}

/** "Executar de verdade em Build", offered on the last Teste turn. */
export interface SteelAiRunForReal {
  onRun: () => void
  /** Why it is unavailable (agent mode switched off), if it is. */
  disabledReason: string | null
  busy: boolean
}

type SimulatedCall = AiToolCallDTO & {
  simulation: NonNullable<AiToolCallDTO['simulation']>
}

function AssistantBlock({
  workspaceId,
  content,
  toolCalls,
  pendingActions,
  streaming,
  footer,
  runForReal,
}: {
  workspaceId: string
  content: string
  toolCalls: AiToolCallDTO[]
  pendingActions: AiPendingActionDTO[]
  streaming?: boolean
  footer?: string | null
  runForReal?: SteelAiRunForReal
}) {
  const thinking = streaming && !content && toolCalls.length === 0
  const simulated = toolCalls.filter(
    (call): call is SimulatedCall =>
      call.status === 'simulated' && Boolean(call.simulation),
  )
  const simulatedIds = new Set(simulated.map((call) => call.id))
  const chips = toolCalls.filter((call) => !simulatedIds.has(call.id))
  const citations = citationsOf(toolCalls)
  return (
    <div className='flex min-w-0 gap-3'>
      <span
        aria-hidden
        className='mt-0.5 hidden size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary sm:flex'
      >
        <SteelIcon
          icon={AiMagicIcon}
          strokeWidth={2}
          className={cn('size-4', streaming && 'motion-safe:animate-pulse')}
        />
      </span>
      <div className='min-w-0 flex-1 space-y-3'>
        {chips.length > 0 ? (
          <ul
            className='flex flex-wrap gap-1.5'
            aria-label='Ferramentas usadas'
          >
            {chips.map((call) =>
              call.memory ? (
                <SteelAiMemoryChip
                  key={call.id}
                  workspaceId={workspaceId}
                  memory={call.memory}
                />
              ) : (
                <SteelAiToolCall key={call.id} call={call} />
              ),
            )}
          </ul>
        ) : null}
        {thinking ? (
          <p
            className='pt-1 text-muted-foreground text-sm motion-safe:animate-pulse'
            aria-live='polite'
          >
            Pensando…
          </p>
        ) : null}
        {content ? (
          <div className='relative'>
            <SteelAiMarkdown content={content} />
            {streaming ? (
              <span
                aria-hidden
                className='ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 rounded-sm bg-foreground/60 motion-safe:animate-pulse'
              />
            ) : null}
          </div>
        ) : null}
        {citations.length > 0 && !streaming ? (
          <SteelAiCitations citations={citations} />
        ) : null}
        {simulated.map((call) => (
          <SteelAiSimulatedActionCard key={call.id} call={call} />
        ))}
        {simulated.length > 0 && !streaming ? (
          <SteelAiSimulationSummary
            count={simulated.length}
            onRunForReal={runForReal?.onRun}
            runForRealDisabledReason={runForReal?.disabledReason}
            busy={runForReal?.busy}
          />
        ) : null}
        {pendingActions.map((action) =>
          action.autoExecuted ? (
            <SteelAiExecutedActionCard key={action.id} action={action} />
          ) : (
            <SteelAiPendingActionCard
              key={action.id}
              workspaceId={workspaceId}
              action={action}
            />
          ),
        )}
        {footer ? (
          <p className='text-muted-foreground text-xs italic'>{footer}</p>
        ) : null}
      </div>
    </div>
  )
}

export function SteelAiTranscriptSkeleton() {
  return (
    <div className='space-y-8' role='status' aria-label='Carregando conversa'>
      <div className='flex justify-end'>
        <Skeleton className='h-10 w-2/5 rounded-2xl' />
      </div>
      <div className='flex gap-3'>
        <Skeleton className='hidden size-7 shrink-0 rounded-full sm:block' />
        <div className='flex-1 space-y-2'>
          <Skeleton className='h-4 w-11/12' />
          <Skeleton className='h-4 w-9/12' />
          <Skeleton className='h-4 w-10/12' />
        </div>
      </div>
    </div>
  )
}

/** Persisted messages followed by the turn being streamed, if any. */
export function SteelAiTranscript({
  workspaceId,
  messages,
  pendingUserMessage,
  pendingAttachments = [],
  live,
  runForReal,
}: {
  workspaceId: string
  messages: AiMessageDTO[]
  pendingUserMessage: string | null
  pendingAttachments?: AiAttachmentDTO[]
  live: SteelAiLiveMessage | null
  /** Offered on the last assistant turn only (when it simulated writes). */
  runForReal?: SteelAiRunForReal
}) {
  const lastId = live ? null : messages.at(-1)?.id
  return (
    <div className='space-y-6 sm:space-y-8'>
      {messages.map((message) =>
        message.role === 'USER' ? (
          <UserBubble
            key={message.id}
            content={message.content}
            attachments={message.attachments}
          />
        ) : (
          <AssistantBlock
            key={message.id}
            workspaceId={workspaceId}
            content={message.content}
            toolCalls={message.toolCalls}
            pendingActions={message.pendingActions}
            runForReal={message.id === lastId ? runForReal : undefined}
          />
        ),
      )}
      {pendingUserMessage !== null ? (
        <UserBubble
          content={pendingUserMessage}
          attachments={pendingAttachments}
          animate
        />
      ) : null}
      {live ? (
        <AssistantBlock
          workspaceId={workspaceId}
          content={live.content}
          toolCalls={live.toolCalls}
          pendingActions={live.pendingActions}
          streaming={live.status === 'streaming'}
          footer={live.status === 'stopped' ? 'Resposta interrompida.' : null}
          runForReal={live.status === 'streaming' ? undefined : runForReal}
        />
      ) : null}
    </div>
  )
}
