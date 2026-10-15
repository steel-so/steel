'use client'

import {
  ComputerIcon,
  SmartPhone01Icon,
} from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { cn } from '@/lib/utils'
import {
  type SerpDevice,
  serpPreview,
  serpUrl,
} from '@/src/lib/sites/search/serp'

/**
 * Google result as it would look (desktop or mobile), and the card WhatsApp,
 * LinkedIn and X show when the page is shared. Neutral colors on purpose:
 * it previews someone else's interface, not Steel's.
 */
export function SerpPreview({
  title,
  description,
  url,
  siteName,
}: {
  title: string
  description: string
  url: string
  siteName: string
}) {
  const [device, setDevice] = useState<SerpDevice>('desktop')
  const preview = serpPreview(
    title,
    description || 'Sem descrição: o Google escolhe um trecho da página.',
    device,
  )
  return (
    <div className='grid gap-2' data-testid='serp-preview'>
      <div className='flex items-center justify-between gap-2'>
        <p className='font-medium text-muted-foreground text-xs'>
          Prévia no Google
        </p>
        <fieldset className='m-0 inline-flex rounded-md border p-0.5'>
          <legend className='sr-only'>Dispositivo da prévia</legend>
          {(
            [
              ['desktop', ComputerIcon, 'Computador'],
              ['mobile', SmartPhone01Icon, 'Celular'],
            ] as const
          ).map(([value, icon, label]) => (
            <button
              key={value}
              type='button'
              aria-pressed={device === value}
              aria-label={label}
              title={label}
              onClick={() => setDevice(value)}
              className={cn(
                'inline-flex size-6 items-center justify-center rounded-sm text-muted-foreground',
                device === value && 'bg-muted text-foreground',
              )}
            >
              <SteelIcon icon={icon} className='size-3.5' />
            </button>
          ))}
        </fieldset>
      </div>
      <div
        className={cn(
          'grid gap-1 rounded-md border bg-card px-3 py-2.5',
          device === 'mobile' && 'max-w-[360px]',
        )}
      >
        <div className='flex min-w-0 items-center gap-2'>
          <span
            aria-hidden
            className='inline-flex size-6 shrink-0 items-center justify-center rounded-full border bg-muted font-semibold text-[10px]'
          >
            {(siteName.trim().charAt(0) || 'S').toUpperCase()}
          </span>
          <span className='grid min-w-0 leading-tight'>
            <span className='truncate text-xs'>{siteName}</span>
            <span className='truncate text-[11px] text-muted-foreground'>
              {serpUrl(url)}
            </span>
          </span>
        </div>
        <p
          className={cn(
            'font-medium text-primary leading-snug',
            device === 'mobile' ? 'text-base' : 'text-lg',
          )}
        >
          {preview.title}
        </p>
        <p className='text-muted-foreground text-xs leading-relaxed'>
          {preview.description}
        </p>
      </div>
      {preview.titleCut || preview.descriptionCut ? (
        <p className='text-[11px] text-muted-foreground'>
          {preview.titleCut ? 'O título é cortado. ' : ''}
          {preview.descriptionCut ? 'A descrição é cortada.' : ''}
        </p>
      ) : null}
    </div>
  )
}

/** Link card of social networks and messengers (Open Graph / X). */
export function SocialPreview({
  title,
  description,
  image,
  host,
}: {
  title: string
  description: string
  image: string | null
  host: string
}) {
  return (
    <div className='grid gap-2' data-testid='social-preview'>
      <p className='font-medium text-muted-foreground text-xs'>
        Prévia nas redes (Open Graph e X)
      </p>
      <div className='overflow-hidden rounded-md border bg-card'>
        {image ? (
          <img
            src={image}
            alt=''
            width={1200}
            height={630}
            loading='lazy'
            className='aspect-[1200/630] h-auto w-full bg-muted object-cover'
          />
        ) : (
          <div className='flex aspect-[1200/630] items-center justify-center bg-muted px-6 text-center font-semibold text-muted-foreground text-sm'>
            {title}
          </div>
        )}
        <div className='grid gap-0.5 border-t px-3 py-2'>
          <span className='truncate text-[11px] text-muted-foreground uppercase'>
            {host}
          </span>
          <span className='line-clamp-1 font-medium text-xs'>{title}</span>
          <span className='line-clamp-2 text-[11px] text-muted-foreground'>
            {description}
          </span>
        </div>
      </div>
    </div>
  )
}
