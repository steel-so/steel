'use client'

import Link from 'next/link'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { tourEntryPath } from '@/src/lib/tours/match'
import {
  TOUR_MODULE_LABELS,
  TOUR_MODULE_ORDER,
  type TourDefinition,
} from '@/src/lib/tours/types'
import { TOUR_QUERY_PARAM } from './tour-dom'
import { useTours } from './tour-provider'

function TourAction({
  tour,
  onNavigate,
}: {
  tour: TourDefinition
  onNavigate: () => void
}) {
  const tours = useTours()
  if (!tours) return null

  if (tours.currentTour?.key === tour.key) {
    return (
      <Button size='xs' onClick={() => tours.start(tour)}>
        Ver agora
      </Button>
    )
  }

  const entry = tourEntryPath(tour)
  if (!entry) return null
  const href = entry.direct
    ? `/${tours.slug}${entry.path}?${TOUR_QUERY_PARAM}=${encodeURIComponent(tour.key)}`
    : `/${tours.slug}${entry.path}`

  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={buttonVariants({ size: 'xs', variant: 'outline' })}
    >
      {entry.direct ? 'Abrir' : 'Ir para a tela'}
    </Link>
  )
}

/** Every guided tour the user can see, grouped by module. */
export function TourListDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const tours = useTours()
  if (!tours) return null

  const groups = TOUR_MODULE_ORDER.map((module) => ({
    module,
    items: tours.tours.filter((tour) => tour.module === module),
  })).filter((group) => group.items.length > 0)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='flex max-h-[85dvh] flex-col gap-4 sm:max-w-xl'>
        <DialogHeader>
          <DialogTitle>Tours guiados</DialogTitle>
          <DialogDescription>
            Um passo a passo curto de cada tela. Abra de novo sempre que
            precisar.
          </DialogDescription>
        </DialogHeader>
        <div className='-mx-2 flex min-h-0 flex-col gap-5 overflow-y-auto px-2'>
          {groups.map((group) => (
            <section key={group.module} className='flex flex-col gap-1'>
              <h3 className='text-xs font-medium text-muted-foreground'>
                {TOUR_MODULE_LABELS[group.module]}
              </h3>
              <ul className='flex flex-col divide-y divide-border'>
                {group.items.map((tour) => {
                  const entry = tourEntryPath(tour)
                  return (
                    <li
                      key={tour.key}
                      className='flex items-center justify-between gap-3 py-2.5'
                    >
                      <div className='flex min-w-0 flex-col gap-0.5'>
                        <span className='flex items-center gap-2 text-sm font-medium'>
                          <span className='truncate'>{tour.title}</span>
                          {tours.isSeen(tour) && (
                            <span className='shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground'>
                              Visto
                            </span>
                          )}
                        </span>
                        <span className='text-xs text-muted-foreground'>
                          {tour.description}
                          {entry && !entry.direct
                            ? ' O tour abre ao entrar em um item.'
                            : ''}
                        </span>
                      </div>
                      <div className='shrink-0'>
                        <TourAction
                          tour={tour}
                          onNavigate={() => onOpenChange(false)}
                        />
                      </div>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
