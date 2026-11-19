import { cacheLife, cacheTag } from 'next/cache'
import { bioCacheTag } from '@/src/lib/bio-link/cache'
import { BioLinkPublicService } from '@/src/services/bio-link-public.service'
import { CrmFormService } from '@/src/services/crm-form.service'
import type { BioLinkPublicDTO } from '@/types/bio-link'
import type { CrmFormPublicDTO } from '@/types/crm-form'

/**
 * Cached reads of the public bio page, tagged `bio:<slug>`: saving,
 * publishing, unpublishing, renaming or deleting the page expires them (see
 * `revalidateBioLinks`). Schedules are checked per request, not here.
 */

export async function loadPublishedBio(
  slug: string,
): Promise<BioLinkPublicDTO | null> {
  'use cache'
  cacheTag(bioCacheTag(slug))
  cacheLife('minutes')
  const result = await BioLinkPublicService.getPublished(slug)
  return result.ok ? result.value : null
}

/** CRM forms of embedded form blocks; short life, since forms are edited
 * outside the page and do not expire its tag. */
export async function loadBioForms(
  slug: string,
  formTokens: string[],
): Promise<Record<string, CrmFormPublicDTO>> {
  'use cache'
  cacheTag(bioCacheTag(slug))
  cacheLife('minutes')
  const forms: Record<string, CrmFormPublicDTO> = {}
  for (const token of formTokens) {
    const result = await CrmFormService.getPublicByToken(token)
    if (result.ok) forms[token] = result.value
  }
  return forms
}
