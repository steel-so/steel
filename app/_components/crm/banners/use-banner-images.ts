'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  type BannerImageCache,
  createImageCache,
  ensureFonts,
  imageSources,
} from '@/src/lib/banners/render'
import type { BannerFormat } from '@/src/schemas/crm-banner.schema'

/** One shared image cache per workspace view. */
export function useBannerImageCache(workspaceId: string): BannerImageCache {
  return useMemo(() => createImageCache(workspaceId), [workspaceId])
}

/**
 * Loads the images (and fonts) the given formats need and returns what is
 * ready, re-rendering when something arrives.
 */
export function useBannerImages(
  cache: BannerImageCache,
  formats: BannerFormat[],
): { images: Map<string, HTMLImageElement>; fontsReady: boolean } {
  const [images, setImages] = useState<Map<string, HTMLImageElement>>(
    () => new Map(),
  )
  const [fontsReady, setFontsReady] = useState(false)

  const key = useMemo(
    () => [...new Set(formats.flatMap(imageSources))].sort().join('\n'),
    [formats],
  )

  useEffect(() => {
    let cancelled = false
    void ensureFonts().then(() => {
      if (!cancelled) setFontsReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const sources = key ? key.split('\n') : []
    void Promise.all(sources.map((src) => cache.load(src))).then(() => {
      if (!cancelled) setImages(cache.ready())
    })
    return () => {
      cancelled = true
    }
  }, [cache, key])

  return { images, fontsReady }
}
