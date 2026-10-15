'use client'

import { WebDesign01Icon } from '@hugeicons-pro/core-stroke-rounded'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useRef } from 'react'
import {
  SiteSnapshot,
  useNearViewport,
} from '@/app/_components/canvas-site/site-snapshot'
import { toPageLinks } from '@/app/_components/crm/sites/site-editor-context'
import { SteelIcon } from '@/components/icon/icon'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { crmSitesApi, crmSitesKeys } from '@/src/hooks/use-crm-sites'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import { parseSiteTheme } from '@/src/lib/canvas-site/theme'

/**
 * A page of a site (with its header and footer) drawn small — the same
 * snapshot the Sites list uses. Loads only near the viewport and shares the
 * editor's query cache. `pageId` null = the home page.
 */
export function CampaignSiteThumbnail({
  workspaceId,
  siteId,
  pageId,
  updatedAt,
  className,
}: {
  workspaceId: string
  siteId: string
  pageId: string | null
  updatedAt: string
  className?: string
}) {
  const box = useRef<HTMLDivElement>(null)
  const near = useNearViewport(box)
  const data = useQuery({
    queryKey: [
      ...crmSitesKeys.site(workspaceId, siteId),
      'campaign-thumbnail',
      pageId,
      updatedAt,
    ],
    enabled: near,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async () => {
      const api = crmSitesApi(workspaceId)
      const [site, pages, globals] = await Promise.all([
        api.get(siteId),
        api.pages(siteId),
        api.globals(siteId),
      ])
      const target =
        pages.find((page) => page.id === pageId) ??
        pages.find((page) => page.id === site.homePageId) ??
        pages.find((page) => page.isHome) ??
        pages[0]
      const page = target ? await api.page(siteId, target.id) : null
      const symbols: Record<string, CanvasDocument> = {}
      for (const global of globals) {
        if (global.kind === 'SYMBOL') symbols[global.id] = global.document
      }
      const header = globals.find((global) => global.kind === 'HEADER')
      const footer = globals.find((global) => global.kind === 'FOOTER')
      return {
        theme: parseSiteTheme(site.theme),
        links: toPageLinks(pages),
        symbols,
        docs: [header?.document, page?.document, footer?.document].filter(
          (doc): doc is CanvasDocument => doc !== undefined,
        ),
      }
    },
  })
  const context = useMemo(
    () => ({ pages: data.data?.links ?? [], symbols: data.data?.symbols }),
    [data.data],
  )
  return (
    <div
      ref={box}
      className={cn(
        'aspect-[16/10] w-full overflow-hidden bg-muted/40',
        className,
      )}
    >
      {data.data ? (
        <SiteSnapshot
          docs={data.data.docs}
          theme={data.data.theme}
          context={context}
          className='size-full bg-background'
        />
      ) : data.error ? (
        <div className='flex size-full items-center justify-center text-muted-foreground/60'>
          <SteelIcon icon={WebDesign01Icon} className='size-8' />
        </div>
      ) : (
        <Skeleton className='size-full rounded-none' />
      )}
    </div>
  )
}
