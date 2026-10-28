'use client'

import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import type {
  SiteLiveNewsletter,
  SiteNewsletterOptionDTO,
} from '@/src/schemas/crm-newsletter-archive.schema'
import { apiFetch } from './_fetch'

/**
 * Newsletters of the workspace for the Sites editor (slice nl-archive):
 * the picker of `site.newsletter-subscribe` / `site.newsletter-issues` and
 * the live data those elements draw on the canvas and in the preview.
 */

export const siteNewslettersKey = (workspaceId: string) =>
  ['crm-sites', workspaceId, 'newsletters'] as const

export function useSiteNewsletters(workspaceId: string) {
  return useQuery<SiteNewsletterOptionDTO[]>({
    queryKey: siteNewslettersKey(workspaceId),
    queryFn: () =>
      apiFetch<SiteNewsletterOptionDTO[]>(
        `/api/workspaces/${workspaceId}/crm/sites/newsletters`,
      ),
    staleTime: 60_000,
  })
}

/** The same list keyed by id, as `SiteRenderContext.newsletters`. */
export function useLiveSiteNewsletters(
  workspaceId: string,
): Record<string, SiteLiveNewsletter> {
  const newsletters = useSiteNewsletters(workspaceId)
  return useMemo(() => {
    const out: Record<string, SiteLiveNewsletter> = {}
    for (const { id, ...live } of newsletters.data ?? []) out[id] = live
    return out
  }, [newsletters.data])
}
