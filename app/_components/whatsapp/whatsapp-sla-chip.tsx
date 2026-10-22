'use client'

import { Alert02Icon, Clock01Icon } from '@hugeicons-pro/core-stroke-rounded'
import { useEffect, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { useWhatsAppSlaOpenCycles } from '@/src/hooks/use-whatsapp-sla'
import {
  formatSlaCountdown,
  slaChipView,
  type WhatsAppSlaListFilter,
} from '@/src/lib/whatsapp/sla-format'
import type { WhatsAppSlaOpenCycleDTO } from '@/types/whatsapp-sla'

/** Re-renders every 30 s so countdowns and states move without a refetch. */
export function useSlaClock(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30 * 1000)
    return () => clearInterval(timer)
  }, [])
  return now
}

/** The open SLA cycle of each conversation, by conversation id. */
export function useWhatsAppSlaByConversation(workspaceId: string) {
  const cycles = useWhatsAppSlaOpenCycles(workspaceId)
  const byConversation = new Map<string, WhatsAppSlaOpenCycleDTO>()
  for (const cycle of cycles.data ?? []) {
    byConversation.set(cycle.conversationId, cycle)
  }
  return byConversation
}

/**
 * Discrete SLA indicator of the conversation header: the running target and
 * its time left, or "estourado". Renders nothing when no policy applies.
 */
export function WhatsappSlaChip({
  workspaceId,
  conversationId,
  className,
}: {
  workspaceId: string
  conversationId: string
  className?: string
}) {
  const cycles = useWhatsAppSlaByConversation(workspaceId)
  const now = useSlaClock()
  const cycle = cycles.get(conversationId)
  const view = cycle ? slaChipView(cycle, now) : null
  if (!view) return null

  const breached = view.state === 'BREACHED'
  const text = `${view.label} ${formatSlaCountdown(view.target.dueAt, now)}`
  return (
    <Badge
      variant={
        breached
          ? 'destructive'
          : view.state === 'AT_RISK'
            ? 'secondary'
            : 'outline'
      }
      className={cn(
        'max-w-56',
        view.state === 'OK' && 'text-muted-foreground',
        view.state === 'AT_RISK' && 'font-semibold',
        className,
      )}
      title={`SLA: ${text}`}
      data-sla-state={view.state}
    >
      <SteelIcon icon={breached ? Alert02Icon : Clock01Icon} size={11} />
      <span className='truncate'>
        {breached ? `SLA estourado · ${text}` : text}
      </span>
    </Badge>
  )
}

const FILTER_LABELS: Record<WhatsAppSlaListFilter, string> = {
  all: 'Qualquer SLA',
  risk: 'SLA em risco ou estourado',
  breached: 'SLA estourado',
}

/**
 * List filter "SLA em risco / estourado". Hidden while the workspace has no
 * open SLA cycle (no policy turned on).
 */
export function WhatsappSlaFilterSelect({
  workspaceId,
  value,
  onChange,
}: {
  workspaceId: string
  value: WhatsAppSlaListFilter
  onChange: (value: WhatsAppSlaListFilter) => void
}) {
  const cycles = useWhatsAppSlaOpenCycles(workspaceId)
  if (!cycles.data?.length && value === 'all') return null

  return (
    <Select
      value={value}
      onValueChange={(next) =>
        onChange((next ?? 'all') as WhatsAppSlaListFilter)
      }
    >
      <SelectTrigger
        size='sm'
        className='mt-1.5 w-full'
        aria-label='Filtrar conversas por SLA'
      >
        <SelectValue>{FILTER_LABELS[value]}</SelectValue>
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        <SelectGroup>
          <SelectItem value='all'>{FILTER_LABELS.all}</SelectItem>
          <SelectItem value='risk'>{FILTER_LABELS.risk}</SelectItem>
          <SelectItem value='breached'>{FILTER_LABELS.breached}</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
