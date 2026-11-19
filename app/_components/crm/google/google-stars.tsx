import { StarIcon } from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { cn } from '@/lib/utils'

/** Five stars, filled up to `value` (rounded to the nearest star). */
export function GoogleStars({
  value,
  size = 14,
  className,
}: {
  value: number
  size?: number
  className?: string
}) {
  const filled = Math.round(value)
  return (
    <span
      role='img'
      aria-label={`${value} de 5 estrelas`}
      className={cn('inline-flex items-center gap-0.5', className)}
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <SteelIcon
          key={star}
          icon={StarIcon}
          size={size}
          className={cn(
            star <= filled
              ? 'fill-amber-400 text-amber-400'
              : 'text-muted-foreground/40',
          )}
        />
      ))}
    </span>
  )
}
