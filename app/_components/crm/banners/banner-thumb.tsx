'use client'

import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { renderFormat } from '@/src/lib/banners/render'
import type { BannerFormat } from '@/src/schemas/crm-banner.schema'

const THUMB_SIDE = 520

/** A format drawn small, with the same renderer as the editor and export. */
export function BannerThumb({
  format,
  images,
  fontsReady,
  className,
}: {
  format: BannerFormat
  images: ReadonlyMap<string, HTMLImageElement>
  fontsReady: boolean
  className?: string
}) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const scale = Math.min(
      1,
      THUMB_SIDE / Math.max(format.width, format.height),
    )
    canvas.width = Math.max(1, Math.round(format.width * scale))
    canvas.height = Math.max(1, Math.round(format.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    renderFormat(ctx, format, { scale, images })
    void fontsReady
  }, [format, images, fontsReady])

  return (
    <canvas
      ref={ref}
      role='img'
      aria-label={`Miniatura do banner ${format.width} por ${format.height}`}
      className={cn('max-h-full max-w-full object-contain', className)}
    />
  )
}
