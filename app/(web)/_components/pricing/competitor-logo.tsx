'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { competitorLogoUrl } from '@/src/lib/pricing/comparison'

/** `Jira Service Management` → `JS`; `Blip` → `B`. */
function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('')
}

/**
 * Vendor icon hotlinked from Brandfetch. The CDN refuses anything but a
 * browser loading it from a page, so this is a plain <img> (next/image would
 * fetch it from the server). Blocked or failed loads (ad blockers, CDN down)
 * fall back to the product initials instead of a broken image.
 */
export function CompetitorLogo({
  domain,
  name,
  size,
  decorative = false,
  className,
}: {
  domain: string
  name: string
  size: number
  /** The name is already next to it: hide the logo from assistive tech. */
  decorative?: boolean
  className?: string
}) {
  const [failed, setFailed] = useState(false)
  const ref = useRef<HTMLImageElement>(null)

  // A server-rendered <img> can fail before hydration attaches onError, so
  // the lost event is recovered from the element's state on mount.
  useEffect(() => {
    const img = ref.current
    if (img?.complete && img.naturalWidth === 0) setFailed(true)
  }, [])
  const label = decorative ? {} : { role: 'img', 'aria-label': name }

  if (failed) {
    return (
      <span
        {...label}
        aria-hidden={decorative || undefined}
        title={name}
        style={{ width: size, height: size }}
        className={cn(
          'inline-flex shrink-0 items-center justify-center rounded-md bg-muted text-[10px] font-semibold text-muted-foreground',
          className,
        )}
      >
        {initials(name)}
      </span>
    )
  }

  return (
    <img
      ref={ref}
      src={competitorLogoUrl(domain)}
      alt={decorative ? '' : name}
      aria-hidden={decorative || undefined}
      title={name}
      width={size}
      height={size}
      loading='lazy'
      onError={() => setFailed(true)}
      style={{ width: size, height: size }}
      className={cn('shrink-0 rounded-md object-contain', className)}
    />
  )
}
