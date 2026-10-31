import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { qaScoreTone } from './qa-format'

/** Score 0–100 as a badge: destructive when low, primary when great. */
export function QaScoreBadge({
  score,
  lowScore,
  className,
}: {
  score: number | null
  lowScore?: boolean
  className?: string
}) {
  if (score === null) {
    return (
      <Badge variant='outline' className={className}>
        —
      </Badge>
    )
  }
  const tone = lowScore ? 'low' : qaScoreTone(score, 0)
  return (
    <Badge
      variant={
        tone === 'low' ? 'destructive' : tone === 'good' ? 'default' : 'secondary'
      }
      className={cn('tabular-nums', className)}
    >
      {score}
    </Badge>
  )
}
