'use client'

import { Route01Icon } from '@hugeicons-pro/core-stroke-rounded'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import { useTours } from './tour-provider'

/** "Ver tour" in the header: only on screens that have a guided tour. */
export function TourReplayButton() {
  const tours = useTours()
  const tour = tours?.currentTour
  if (!tours || !tour) return null

  return (
    <Button
      data-tour='app-replay'
      variant='ghost'
      size='sm'
      aria-label='Ver tour desta tela'
      title={`Ver tour: ${tour.title}`}
      className='rounded-md px-1.5 text-xs'
      onClick={() => tours.start(tour)}
    >
      <SteelIcon icon={Route01Icon} strokeWidth={2} size={18} />
      <span className='hidden xl:inline'>Ver tour</span>
    </Button>
  )
}
