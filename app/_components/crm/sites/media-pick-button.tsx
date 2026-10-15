'use client'

import { Image01Icon } from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { useSiteMedia } from '@/src/hooks/use-crm-sites'

/** "Escolher da mídia": picks an image URL from the site media library. */
export function MediaPickButton({
  workspaceId,
  onPick,
  label = 'Escolher da mídia',
}: {
  workspaceId: string
  onPick: (url: string) => void
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const media = useSiteMedia(workspaceId)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button type='button' variant='outline' size='sm'>
            <SteelIcon icon={Image01Icon} data-icon='inline-start' />
            {label}
          </Button>
        }
      />
      <PopoverContent align='start' className='w-80 p-3'>
        {media.isLoading ? (
          <div className='grid grid-cols-3 gap-2'>
            <Skeleton className='aspect-square' />
            <Skeleton className='aspect-square' />
            <Skeleton className='aspect-square' />
          </div>
        ) : (media.data ?? []).length === 0 ? (
          <p className='py-4 text-center text-muted-foreground text-sm'>
            Nenhuma imagem ainda. Envie imagens na aba Mídia do editor.
          </p>
        ) : (
          <ul className='grid max-h-72 grid-cols-3 gap-2 overflow-y-auto'>
            {(media.data ?? []).map((item) => (
              <li key={`${item.source}-${item.id}`}>
                <button
                  type='button'
                  aria-label={`Usar ${item.id}`}
                  onClick={() => {
                    onPick(item.url)
                    setOpen(false)
                  }}
                  className='block aspect-square w-full overflow-hidden rounded-md border bg-muted transition-[box-shadow] hover:ring-2 hover:ring-primary/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
                >
                  <img
                    src={item.url}
                    alt=''
                    loading='lazy'
                    className='size-full object-cover'
                  />
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}
