'use client'

import * as React from 'react'
import { GhostImageAltContext } from '@/components/ui/ghost-image'

/**
 * Alt text for landing page images lives in the section's `texts` override
 * map, keyed by a short hash of the image URL, so it follows the image when
 * the section is moved or duplicated and needs no schema change. A stored
 * empty string marks the image as decorative.
 */
export function imageAltKey(url: string): string {
  let hash = 5381
  for (let i = 0; i < url.length; i += 1) {
    hash = ((hash * 33) ^ url.charCodeAt(i)) >>> 0
  }
  return `alt.${hash.toString(36)}`
}

export function LandingImageAlt({
  texts,
  onEdit,
  children,
}: {
  texts?: Record<string, string>
  onEdit?: (key: string, alt: string) => void
  children: React.ReactNode
}) {
  const api = React.useMemo(
    () => ({
      resolve: (url: string) => texts?.[imageAltKey(url)],
      edit: onEdit
        ? (url: string, alt: string) => onEdit(imageAltKey(url), alt)
        : undefined,
    }),
    [texts, onEdit],
  )
  return (
    <GhostImageAltContext.Provider value={api}>
      {children}
    </GhostImageAltContext.Provider>
  )
}
