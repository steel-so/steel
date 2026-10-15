import { cn } from '@/lib/utils'
import type { SiteStatusDTO } from '@/types/site'

/** "Publicado" / "Rascunho" pill of a site. */
export function SiteStatusBadge({
  status,
  className,
}: {
  status: SiteStatusDTO
  className?: string
}) {
  const live = status === 'PUBLISHED'
  return (
    <span
      data-status={status}
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
          live ? 'bg-primary' : 'bg-muted-foreground/60',
        )}
      />
      {live ? 'Publicado' : 'Rascunho'}
    </span>
  )
}
