'use client'

import {
  AiBrain01Icon,
  CheckmarkBadge01Icon,
  Shield01Icon,
  Wrench01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { SteelAgentRunStepDTO } from '@/types/steel-agent'
import { formatAgentDate, STEP_STATUS_LABEL } from './steel-agent-labels'
import {
  summarizeTrace,
  type TraceEntry,
  traceEntry,
} from './steel-agent-trace-model'

const STEP_ICON = {
  MODEL: AiBrain01Icon,
  TOOL: Wrench01Icon,
  APPROVAL: CheckmarkBadge01Icon,
  GUARDRAIL: Shield01Icon,
} as const

function Disclosure({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <details className='group mt-1.5 rounded-md border border-border/70 bg-muted/30'>
      <summary className='cursor-pointer select-none px-2 py-1 text-muted-foreground text-xs hover:text-foreground'>
        {label}
      </summary>
      <div className='border-border/70 border-t px-2 py-1.5'>{children}</div>
    </details>
  )
}

function TraceItem({
  entry,
  timezone,
  slug,
}: {
  entry: TraceEntry
  timezone: string
  slug?: string
}) {
  const failed = entry.status === 'FAILED'
  return (
    <li className='relative' data-kind={entry.kind}>
      <span
        className={cn(
          '-left-[33px] absolute top-0 flex size-6 items-center justify-center rounded-full border border-border/80 bg-primary-foreground text-muted-foreground',
          failed && 'border-destructive text-destructive',
          entry.kind === 'GUARDRAIL' && 'border-primary/50 text-primary',
        )}
      >
        <SteelIcon
          icon={STEP_ICON[entry.kind]}
          strokeWidth={2}
          className='size-3.5'
        />
      </span>
      <div className='flex flex-wrap items-center gap-x-2 gap-y-0.5'>
        <span className='min-w-0 break-words font-medium text-sm'>
          {entry.title}
        </span>
        {entry.kind === 'GUARDRAIL' ? (
          <Badge variant='outline'>Guardrail</Badge>
        ) : null}
        <span className='text-muted-foreground text-xs'>
          {entry.kind === 'GUARDRAIL'
            ? ''
            : `${STEP_STATUS_LABEL[entry.status]} · `}
          {formatAgentDate(entry.createdAt, timezone)}
        </span>
      </div>
      {entry.body ? (
        <p
          className={cn(
            'mt-0.5 whitespace-pre-wrap break-words text-muted-foreground text-xs',
            entry.kind !== 'MODEL' && 'line-clamp-4',
          )}
        >
          {entry.body}
        </p>
      ) : null}
      {entry.child && slug ? (
        <Link
          href={`/${slug}/ai/agents/${entry.child.agentId}/runs/${entry.child.runId}`}
          className='mt-0.5 inline-block text-primary text-xs underline'
        >
          Ver a execução
          {entry.child.agentName ? ` de ${entry.child.agentName}` : ' delegada'}
        </Link>
      ) : null}
      {entry.kind === 'MODEL' &&
      (entry.toolCalls.length > 0 || entry.tokens) ? (
        <p className='mt-0.5 text-muted-foreground text-xs'>
          {entry.toolCalls.length > 0
            ? `Decidiu chamar: ${entry.toolCalls.join(', ')}`
            : 'Respondeu sem chamar ferramentas'}
          {entry.tokens
            ? ` · ${entry.tokens.toLocaleString('pt-BR')} tokens`
            : ''}
        </p>
      ) : null}
      {entry.input ? (
        <Disclosure label='Parâmetros enviados'>
          <pre className='max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs'>
            {entry.input}
          </pre>
        </Disclosure>
      ) : null}
      {entry.context ? (
        <Disclosure label='Contexto recuperado'>
          <pre className='max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs'>
            {entry.context.excerpt}
          </pre>
          {entry.context.truncated ? (
            <p className='mt-1 text-muted-foreground text-xs'>
              Trecho inicial: o resultado completo era maior.
            </p>
          ) : null}
        </Disclosure>
      ) : null}
    </li>
  )
}

/** Timeline of a run with the reasoning, context and guardrails behind it. */
export function SteelAgentTrace({
  steps,
  timezone,
  emptyText,
  slug,
}: {
  steps: SteelAgentRunStepDTO[]
  timezone: string
  emptyText: string
  /** Workspace slug, to link delegated runs. */
  slug?: string
}) {
  if (steps.length === 0) {
    return <p className='text-muted-foreground text-sm'>{emptyText}</p>
  }
  const summary = summarizeTrace(steps)
  return (
    <>
      <p className='text-muted-foreground text-xs' data-testid='trace-summary'>
        {summary.rounds} rodada(s) do modelo · {summary.tools} chamada(s) de
        ferramenta ·{' '}
        <span className={cn(summary.guardrails > 0 && 'text-foreground')}>
          {summary.guardrails} regra(s) de guardrail acionada(s)
        </span>
        {summary.approvals > 0
          ? ` · ${summary.approvals} pedido(s) de aprovação`
          : ''}
      </p>
      <ol className='relative ml-3 space-y-4 border-border/80 border-l pl-5'>
        {steps.map((step) => (
          <TraceItem
            key={step.id}
            entry={traceEntry(step)}
            timezone={timezone}
            slug={slug}
          />
        ))}
      </ol>
    </>
  )
}
