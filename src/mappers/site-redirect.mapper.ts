import type { SiteRedirect } from '@prisma/client'
import type { SiteRedirectDTO } from '@/types/site-platform'

export function toSiteRedirectDTO(redirect: SiteRedirect): SiteRedirectDTO {
  return {
    id: redirect.id,
    siteId: redirect.siteId,
    fromPath: redirect.fromPath,
    toPath: redirect.toPath,
    permanent: redirect.permanent,
    createdAt: redirect.createdAt.toISOString(),
    updatedAt: redirect.updatedAt.toISOString(),
  }
}
