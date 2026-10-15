import { cn } from '@/lib/utils'
import type { SiteExperimentState } from '@/types/site-experiment'
import { STATE_LABELS } from './format'

/** "No ar" / "Pausado" / "Rascunho"… pill of an A/B test. */
export function ExperimentStateBadge({
  state,
  className,
}: {
  state: SiteExperimentState
  className?: string
}) {
  const live = state === 'RUNNING'
  return (
    <span
      data-state={state}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 font-medium text-[11px]',
        live ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
        className,
      )}
    >
      <span
        aria-hidden='true'
        className={cn(
          'size-1.5 rounded-full',
          live ? 'animate-pulse bg-primary' : 'bg-muted-foreground/60',
        )}
      />
      {STATE_LABELS[state]}
    </span>
  )
}
