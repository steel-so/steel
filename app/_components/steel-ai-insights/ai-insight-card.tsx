'use client'

import {
  AiMagicIcon,
  ArrowRight01Icon,
  Clock01Icon,
  MoreHorizontalIcon,
  Undo02Icon,
  ViewOffIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import Link from 'next/link'
import { STEEL_AI_MODULE_META } from '@/app/_components/steel-ai/steel-ai-starters'
import { SteelIcon } from '@/components/icon/icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import { useUpdateAiInsight } from '@/src/hooks/use-ai-insights'
import { AI_INSIGHT_SEVERITY_LABELS } from '@/src/lib/ai/proactive/labels'
import type { AiInsightDTO, AiInsightSeverityDTO } from '@/types/ai-insight'

/** Snooze presets of the card menu, in hours. */
export const AI_INSIGHT_SNOOZE_PRESETS: { hours: number; label: string }[] = [
  { hours: 1, label: 'Por 1 hora' },
  { hours: 4, label: 'Por 4 horas' },
  { hours: 24, label: 'Por 1 dia' },
  { hours: 168, label: 'Por 1 semana' },
]

const SEVERITY_BADGE: Record<
  AiInsightSeverityDTO,
  'destructive' | 'secondary' | 'outline'
> = {
  CRITICAL: 'destructive',
  WARNING: 'secondary',
  INFO: 'outline',
}

/** `/ai?prompt=` — the welcome screen fills the composer, the user sends. */
export function steelAiPromptHref(slug: string, prompt: string): string {
  return `/${slug}/ai?prompt=${encodeURIComponent(prompt)}`
}

/** "volta em 3 h" / "volta em 2 dias" (relative: no time zone involved). */
export function snoozeLabel(until: string, now: number): string {
  const left = Math.max(0, Date.parse(until) - now)
  const hours = Math.ceil(left / 3_600_000)
  if (hours <= 1) return 'Volta em até 1 h'
  if (hours < 48) return `Volta em ${hours} h`
  return `Volta em ${Math.ceil(hours / 24)} dias`
}

/**
 * One proactive AI insight (ADR 0040): module and severity, the title with
 * the numbers, why (body + facts), and the actions — open the records,
 * ask the Steel AI with the prompt prefilled, snooze, dismiss or restore.
 * `compact` drops the facts and the body for the home and Steel AI lists.
 */
export function AiInsightCard({
  workspaceId,
  slug,
  insight,
  compact = false,
  now = Date.now(),
}: {
  workspaceId: string
  slug: string
  insight: AiInsightDTO
  compact?: boolean
  now?: number
}) {
  const update = useUpdateAiInsight(workspaceId)
  const meta = STEEL_AI_MODULE_META[insight.module]
  const hidden = insight.state !== 'active'

  function act(
    dto:
      | { action: 'dismiss' }
      | { action: 'restore' }
      | { action: 'snooze'; hours: number },
    done: string,
  ) {
    update.mutate(
      { id: insight.id, ...dto },
      {
        onSuccess: () => notify.success(done),
        onError: (error) => notify.error(error.message),
      },
    )
  }

  return (
    <article
      aria-label={insight.title}
      className={cn(
        'flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground',
        insight.severity === 'CRITICAL' && 'border-destructive/40',
      )}
    >
      <div className='flex min-w-0 items-start gap-3'>
        <span className='flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground'>
          <SteelIcon icon={meta.icon} size={16} strokeWidth={2} />
        </span>
        <div className='min-w-0 flex-1 space-y-1'>
          <div className='flex flex-wrap items-center gap-2 text-muted-foreground text-xs'>
            <span>{meta.label}</span>
            <Badge variant={SEVERITY_BADGE[insight.severity]}>
              {AI_INSIGHT_SEVERITY_LABELS[insight.severity]}
            </Badge>
            {insight.state === 'snoozed' && insight.snoozedUntil ? (
              <span>{snoozeLabel(insight.snoozedUntil, now)}</span>
            ) : null}
            {insight.state === 'dismissed' ? <span>Dispensado</span> : null}
          </div>
          <h3 className='break-words font-medium text-sm leading-snug'>
            {insight.title}
          </h3>
          {compact ? null : (
            <p className='break-words text-muted-foreground text-sm'>
              {insight.body}
            </p>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                size='icon-sm'
                variant='ghost'
                aria-label='Mais ações do alerta'
                disabled={update.isPending}
              >
                <SteelIcon icon={MoreHorizontalIcon} strokeWidth={2} />
              </Button>
            }
          />
          <DropdownMenuContent align='end'>
            {hidden ? (
              <DropdownMenuItem
                onClick={() => act({ action: 'restore' }, 'Alerta restaurado')}
              >
                <SteelIcon icon={Undo02Icon} strokeWidth={2} />
                Restaurar
              </DropdownMenuItem>
            ) : (
              <>
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Adiar</DropdownMenuLabel>
                  {AI_INSIGHT_SNOOZE_PRESETS.map((preset) => (
                    <DropdownMenuItem
                      key={preset.hours}
                      onClick={() =>
                        act(
                          { action: 'snooze', hours: preset.hours },
                          'Alerta adiado',
                        )
                      }
                    >
                      <SteelIcon icon={Clock01Icon} strokeWidth={2} />
                      {preset.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() =>
                    act({ action: 'dismiss' }, 'Alerta dispensado')
                  }
                >
                  <SteelIcon icon={ViewOffIcon} strokeWidth={2} />
                  Dispensar
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {compact || insight.facts.length === 0 ? null : (
        <dl className='flex flex-wrap gap-2'>
          {insight.facts.map((fact) => (
            <div
              key={fact.label}
              className='flex min-w-0 items-baseline gap-1 rounded-md bg-muted px-2 py-1 text-xs'
            >
              <dt className='text-muted-foreground'>{fact.label}</dt>
              <dd className='font-medium tabular-nums'>{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className='flex flex-wrap items-center gap-2'>
        {insight.href ? (
          <Button
            size='xs'
            variant='outline'
            render={<Link href={insight.href} />}
            nativeButton={false}
          >
            Abrir
            <SteelIcon icon={ArrowRight01Icon} size={14} strokeWidth={2} />
          </Button>
        ) : null}
        {insight.prompt ? (
          <Button
            size='xs'
            variant='ghost'
            render={<Link href={steelAiPromptHref(slug, insight.prompt)} />}
            nativeButton={false}
          >
            <SteelIcon icon={AiMagicIcon} size={14} strokeWidth={2} />
            Perguntar ao Steel AI
          </Button>
        ) : null}
        {/*
         * TODO(ai-feedback, ADR 0039): 👍/👎 on the insight once `AiFeedback`
         * is on main — surface "AI_INSIGHT", target id = `insight.id`.
         */}
      </div>
    </article>
  )
}
