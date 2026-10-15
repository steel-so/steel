import { cn } from '@/lib/utils'
import type { SitePostStatusDTO } from '@/src/schemas/site-blog.schema'

const LABELS: Record<SitePostStatusDTO, string> = {
  DRAFT: 'Rascunho',
  SCHEDULED: 'Agendado',
  PUBLISHED: 'Publicado',
}

/** "Publicado" / "Agendado" / "Rascunho" pill of a blog post. */
export function PostStatusBadge({
  status,
  className,
}: {
  status: SitePostStatusDTO
  className?: string
}) {
  return (
    <span
      data-status={status}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 font-medium text-[11px]',
        status === 'PUBLISHED' && 'bg-primary/10 text-primary',
        status === 'SCHEDULED' && 'bg-accent text-accent-foreground',
        status === 'DRAFT' && 'bg-muted text-muted-foreground',
        className,
      )}
    >
      <span
        aria-hidden='true'
        className={cn(
          'size-1.5 rounded-full',
          status === 'PUBLISHED' && 'bg-primary',
          status === 'SCHEDULED' && 'bg-accent-foreground/70',
          status === 'DRAFT' && 'bg-muted-foreground/60',
        )}
      />
      {LABELS[status]}
    </span>
  )
}
