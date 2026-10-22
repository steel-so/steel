import { EmptyState } from '@/app/_components/steel-ai-usage/usage-charts'
import { formatBrl, formatCount } from './whatsapp-costs-format'

/**
 * Horizontal bars for one breakdown, most expensive first. Value and volume
 * sit beside each bar, so the list is also its own table view.
 */
export function CostBars({
  items,
  label,
  empty = 'Sem envios no período.',
}: {
  items: { key: string; label: string; messages: number; cost: number }[]
  label: string
  empty?: string
}) {
  if (items.length === 0) return <EmptyState>{empty}</EmptyState>
  const max = Math.max(...items.map((item) => item.cost), 0.000001)
  return (
    <ul aria-label={label} className='space-y-2.5'>
      {items.map((item) => (
        <li key={item.key} className='space-y-1'>
          <div className='flex min-w-0 items-baseline gap-2 text-sm'>
            <span className='min-w-0 flex-1 truncate' title={item.label}>
              {item.label}
            </span>
            <span className='shrink-0 text-muted-foreground text-xs tabular-nums'>
              {formatCount(item.messages)} msg
            </span>
            <span className='w-24 shrink-0 text-right font-medium tabular-nums'>
              {formatBrl(item.cost)}
            </span>
          </div>
          <div className='h-1.5 overflow-hidden rounded-full bg-muted'>
            <div
              className='h-full rounded-full bg-primary'
              style={{ width: `${Math.max(2, (item.cost / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}
