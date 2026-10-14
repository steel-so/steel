'use client'

import { Badge } from '@/components/ui/badge'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  TEMPLATE_QUALITY,
  TEMPLATE_STATUS_LABEL,
} from '@/src/lib/whatsapp/button-editor'
import type {
  WhatsAppTemplateQualityDTO,
  WhatsAppTemplateStatusDTO,
} from '@/types/whatsapp-template'

/** The only place the quality colors live: a traffic light is the point of
 * this badge, so it uses fixed hues (dark mode keeps them legible). */
const QUALITY_FILL: Record<WhatsAppTemplateQualityDTO, string> = {
  GREEN: 'bg-emerald-500',
  YELLOW: 'bg-amber-400',
  RED: 'bg-destructive',
  UNKNOWN: 'bg-muted-foreground/40',
}

/** Small rounded square showing Meta's quality rating, with a pt-BR tooltip
 * explaining the level and its risk. */
export function TemplateQualityBadge({
  quality,
  className,
}: {
  quality: WhatsAppTemplateQualityDTO
  className?: string
}) {
  // Anything Meta adds later reads as "not rated" instead of breaking.
  const level: WhatsAppTemplateQualityDTO =
    quality in TEMPLATE_QUALITY ? quality : 'UNKNOWN'
  const meta = TEMPLATE_QUALITY[level]
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role='img'
            aria-label={meta.label}
            data-quality={level}
            className={cn(
              'inline-block size-2.5 shrink-0 rounded-[3px] ring-1 ring-foreground/10 ring-inset',
              QUALITY_FILL[level],
              className,
            )}
          />
        }
      />
      <TooltipContent className='max-w-64'>
        <p className='font-medium'>{meta.label}</p>
        <p className='mt-0.5 opacity-80'>{meta.description}</p>
      </TooltipContent>
    </Tooltip>
  )
}

const STATUS_VARIANT: Record<
  WhatsAppTemplateStatusDTO,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  APPROVED: 'default',
  PENDING: 'secondary',
  REJECTED: 'destructive',
  PAUSED: 'outline',
  DISABLED: 'destructive',
}

export function TemplateStatusBadge({
  status,
  reason,
}: {
  status: WhatsAppTemplateStatusDTO
  reason?: string | null
}) {
  const badge = (
    <Badge variant={STATUS_VARIANT[status]}>
      {TEMPLATE_STATUS_LABEL[status]}
    </Badge>
  )
  if (!reason) return badge
  return (
    <Tooltip>
      <TooltipTrigger render={<span className='inline-flex'>{badge}</span>} />
      <TooltipContent className='max-w-64'>{reason}</TooltipContent>
    </Tooltip>
  )
}

/** Template name with its quality square, as shown in every picker. */
export function TemplateNameWithQuality({
  name,
  quality,
  status,
}: {
  name: string
  quality: WhatsAppTemplateQualityDTO
  status?: WhatsAppTemplateStatusDTO
}) {
  return (
    <span className='inline-flex min-w-0 items-center gap-1.5'>
      <TemplateQualityBadge quality={quality} />
      <span className='truncate'>{name}</span>
      {status && status !== 'APPROVED' ? (
        <span className='shrink-0 text-muted-foreground text-xs'>
          · {TEMPLATE_STATUS_LABEL[status]}
        </span>
      ) : null}
    </span>
  )
}
