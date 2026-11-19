'use client'

import { PlayCircleIcon } from '@hugeicons-pro/core-stroke-rounded'
import { useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'

/**
 * YouTube video of a bio page. Nothing from YouTube loads until the visitor
 * presses play (LGPD: no third-party request, no cookie on page load); then
 * the privacy-enhanced embed takes over.
 */
export function BioVideo({
  videoId,
  title,
  radius,
  color,
  background,
}: {
  videoId: string
  title: string
  radius: number
  color: string
  background: string
}) {
  const [playing, setPlaying] = useState(false)
  return (
    <div
      className='aspect-video w-full overflow-hidden'
      style={{ borderRadius: radius, background }}
    >
      {playing ? (
        <iframe
          className='size-full'
          src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0`}
          title={title}
          allow='autoplay; encrypted-media; picture-in-picture; fullscreen'
          allowFullScreen
          referrerPolicy='strict-origin-when-cross-origin'
        />
      ) : (
        <button
          type='button'
          onClick={() => setPlaying(true)}
          aria-label={`Assistir: ${title}`}
          className='flex size-full flex-col items-center justify-center gap-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-[-4px]'
          style={{ color }}
        >
          <SteelIcon icon={PlayCircleIcon} size={44} strokeWidth={1.5} />
          <span className='max-w-[85%] truncate font-medium'>{title}</span>
        </button>
      )}
    </div>
  )
}
