'use client'

import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type {
  WhatsAppAiCampaignStatsDTO,
  WhatsAppAiCampaignStatusDTO,
} from '@/types/whatsapp-ai-campaign'

export const AI_CAMPAIGN_STATUS_LABEL: Record<
  WhatsAppAiCampaignStatusDTO,
  string
> = {
  DRAFT: 'Rascunho',
  RUNNING: 'Enviando',
  PAUSED: 'Pausada',
  DONE: 'Concluída',
  ARCHIVED: 'Arquivada',
}

export function AiCampaignStatusBadge({
  status,
}: {
  status: WhatsAppAiCampaignStatusDTO
}) {
  return (
    <Badge
      variant={
        status === 'RUNNING'
          ? 'default'
          : status === 'DRAFT'
            ? 'outline'
            : 'secondary'
      }
      className='gap-1.5'
    >
      {status === 'RUNNING' ? (
        <span className='relative flex size-1.5'>
          <span className='absolute inline-flex size-full animate-ping rounded-full bg-primary-foreground/70' />
          <span className='relative inline-flex size-1.5 rounded-full bg-primary-foreground' />
        </span>
      ) : null}
      {AI_CAMPAIGN_STATUS_LABEL[status]}
    </Badge>
  )
}

/** Share of the queue already handled (sent, failed or skipped). */
export function aiCampaignProgress(stats: WhatsAppAiCampaignStatsDTO): number {
  if (stats.total === 0) return 0
  return Math.round(((stats.total - stats.pending) / stats.total) * 100)
}

export function ProgressBar({
  value,
  className,
}: {
  value: number
  className?: string
}) {
  return (
    <div
      role='progressbar'
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      className={cn(
        'h-1.5 w-full overflow-hidden rounded-full bg-muted',
        className,
      )}
    >
      <div
        className='h-full rounded-full bg-primary transition-[width] duration-500'
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  )
}

export function StatTile({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string
  value: ReactNode
  hint?: string
  tone?: 'default' | 'positive' | 'negative'
}) {
  return (
    <div className='rounded-lg border bg-card p-3'>
      <p className='text-muted-foreground text-xs'>{label}</p>
      <p
        className={cn(
          'mt-1 font-semibold text-xl tabular-nums',
          tone === 'positive' && 'text-primary',
          tone === 'negative' && 'text-destructive',
        )}
      >
        {value}
      </p>
      {hint ? <p className='text-muted-foreground text-xs'>{hint}</p> : null}
    </div>
  )
}

function percent(part: number, whole: number): string {
  if (whole === 0) return '0%'
  return `${Math.round((part / whole) * 100)}%`
}

/** Enviados → responderam → deu certo / não deu, as horizontal bars. */
export function AiCampaignFunnel({
  stats,
}: {
  stats: WhatsAppAiCampaignStatsDTO
}) {
  const steps = [
    { label: 'Na campanha', value: stats.total, base: stats.total },
    { label: 'Enviados', value: stats.sent, base: stats.total },
    { label: 'Responderam', value: stats.replied, base: stats.sent },
    {
      label: 'Deu certo',
      value: stats.success,
      base: stats.sent,
      tone: 'positive',
    },
    {
      label: 'Não deu certo',
      value: stats.failure,
      base: stats.sent,
      tone: 'negative',
    },
  ] as const
  const max = Math.max(1, stats.total)

  return (
    <ul className='space-y-2.5'>
      {steps.map((step) => (
        <li key={step.label} className='space-y-1'>
          <div className='flex items-baseline justify-between text-sm'>
            <span>{step.label}</span>
            <span className='text-muted-foreground text-xs tabular-nums'>
              <strong className='text-foreground'>{step.value}</strong>
              {step.label === 'Na campanha'
                ? ''
                : ` · ${percent(step.value, step.base)}`}
            </span>
          </div>
          <div className='h-2 w-full overflow-hidden rounded-full bg-muted'>
            <div
              className={cn(
                'h-full rounded-full transition-[width] duration-500',
                'tone' in step && step.tone === 'negative'
                  ? 'bg-destructive'
                  : 'bg-primary',
                !('tone' in step) && 'opacity-60',
              )}
              style={{ width: `${(step.value / max) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}
