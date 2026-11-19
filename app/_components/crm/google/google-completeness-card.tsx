import { CheckmarkCircle02Icon } from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { GoogleCompletenessDTO } from '@/src/schemas/crm-google-presence.schema'

/** Score ring colour: red below 50, amber below 80, green from 80. */
function scoreTone(score: number): string {
  if (score >= 80) return 'text-emerald-600 dark:text-emerald-400'
  if (score >= 50) return 'text-amber-600 dark:text-amber-400'
  return 'text-rose-600 dark:text-rose-400'
}

/** Checklist of what is still missing on the Google profile. */
export function GoogleCompletenessCard({
  completeness,
}: {
  completeness: GoogleCompletenessDTO
}) {
  const missing = completeness.items.filter((item) => !item.done)
  return (
    <Card className='gap-4 px-5 py-5'>
      <div className='flex items-center justify-between gap-3'>
        <div>
          <h3 className='font-heading font-semibold text-base tracking-tight'>
            Perfil completo
          </h3>
          <p className='text-muted-foreground text-xs'>
            {missing.length === 0
              ? 'Tudo preenchido. Continue atualizando fotos e horários.'
              : `${missing.length} ${missing.length === 1 ? 'item falta' : 'itens faltam'} para completar.`}
          </p>
        </div>
        <span
          className={cn(
            'font-heading font-semibold text-3xl tabular-nums',
            scoreTone(completeness.score),
          )}
        >
          {completeness.score}%
        </span>
      </div>

      <div
        role='progressbar'
        aria-valuenow={completeness.score}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label='Completude do perfil'
        className='h-1.5 overflow-hidden rounded-full bg-muted'
      >
        <div
          className={cn(
            'h-full rounded-full transition-all',
            completeness.score >= 80
              ? 'bg-emerald-500'
              : completeness.score >= 50
                ? 'bg-amber-500'
                : 'bg-rose-500',
          )}
          style={{ width: `${completeness.score}%` }}
        />
      </div>

      <ul className='space-y-2.5'>
        {completeness.items.map((item) => (
          <li key={item.key} className='flex items-start gap-2.5'>
            <SteelIcon
              icon={CheckmarkCircle02Icon}
              size={16}
              className={cn(
                'mt-0.5 shrink-0',
                item.done ? 'text-emerald-500' : 'text-muted-foreground/40',
              )}
            />
            <div className='min-w-0'>
              <p
                className={cn(
                  'text-sm',
                  item.done && 'text-muted-foreground line-through',
                )}
              >
                {item.label}
              </p>
              {item.done ? null : (
                <p className='text-muted-foreground text-xs'>{item.hint}</p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}
