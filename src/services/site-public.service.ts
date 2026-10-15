import { BETTER_AUTH_SECRET } from '@/lib/env/server'
import { appError } from '@/src/errors/app-error'
import { err, ok, type Result } from '@/src/lib/result'
import { publicSiteUrl } from '@/src/lib/sites/public-url'
import { parseSiteSnapshot, type SiteSnapshot } from '@/src/lib/sites/snapshot'
import { referrerHost, siteVisitorHash } from '@/src/lib/sites/visitor'
import { toCrmFormPublicDTO } from '@/src/mappers/crm-form.mapper'
import { SiteRepository } from '@/src/repositories/site.repository'
import type { RecordSiteViewDTO } from '@/src/schemas/site-view.schema'
import type { CrmFormPublicDTO } from '@/types/crm-form'
import { assertModuleEnabled } from './authz'

/** What the public runtime renders: the live snapshot and where it lives. */
export interface PublishedSite {
  id: string
  workspaceId: string
  slug: string
  baseUrl: string
  publishedAt: string
  snapshot: SiteSnapshot
}

/** A CRM form a `site.form` block renders, with the token it posts to. */
export interface SiteFormData {
  form: CrmFormPublicDTO
  publicToken: string
}

const siteNotFound = () => appError('SITE_NOT_FOUND', 'Site não encontrado')

export const SitePublicService = {
  /** The published snapshot behind a slug. No session: the CRM module must
   * be enabled and the site published. */
  async getPublished(slug: string): Promise<Result<PublishedSite>> {
    const site = await SiteRepository.findPublishedBySlug(slug)
    if (!site.ok) return site

    const enabled = await assertModuleEnabled(site.value.workspaceId, 'CRM')
    if (!enabled.ok) return err(siteNotFound())

    const version = site.value.publishedVersion
    const snapshot = parseSiteSnapshot(version.snapshot)
    if (!snapshot.ok) return err(siteNotFound())

    return ok({
      id: site.value.id,
      workspaceId: site.value.workspaceId,
      slug: site.value.slug,
      baseUrl: publicSiteUrl(site.value.slug),
      publishedAt: version.createdAt.toISOString(),
      snapshot: snapshot.value,
    })
  },

  /** Published CRM forms of the site's workspace, by public token.
   * Unknown, draft or foreign tokens are simply absent. */
  async getForms(
    workspaceId: string,
    tokens: string[],
  ): Promise<Result<Record<string, SiteFormData>>> {
    const forms = await SiteRepository.findPublishedForms(workspaceId, tokens)
    if (!forms.ok) return forms
    const byToken: Record<string, SiteFormData> = {}
    for (const form of forms.value) {
      byToken[form.publicToken] = {
        form: toCrmFormPublicDTO(form),
        publicToken: form.publicToken,
      }
    }
    return ok(byToken)
  },

  /** Anonymous page view (see `siteVisitorHash`). The runtime only sends it
   * when the visitor accepted the site's cookie banner, or when the site has
   * none (nothing is stored on the device either way). */
  async recordView(
    slug: string,
    request: {
      ip: string
      userAgent: string
      host: string | null
      now?: Date
    },
    dto: RecordSiteViewDTO,
  ): Promise<Result<void>> {
    const published = await SitePublicService.getPublished(slug)
    if (!published.ok) return published

    const pageId =
      dto.pageId &&
      published.value.snapshot.pages.some((page) => page.id === dto.pageId)
        ? dto.pageId
        : null

    return SiteRepository.recordView({
      siteId: published.value.id,
      pageId,
      path: dto.path,
      visitorHash: siteVisitorHash({
        ip: request.ip,
        userAgent: request.userAgent,
        siteId: published.value.id,
        secret: BETTER_AUTH_SECRET,
        now: request.now ?? new Date(),
      }),
      referrer: referrerHost(dto.referrer, request.host),
      utmSource: dto.utmSource,
      utmMedium: dto.utmMedium,
      utmCampaign: dto.utmCampaign,
      utmTerm: dto.utmTerm,
      utmContent: dto.utmContent,
    })
  },

  /** Where `/l/<shareToken>` goes once its landing page became a published
   * site; `null` keeps the legacy landing page render. */
  async landingRedirect(shareToken: string): Promise<Result<string | null>> {
    const slug =
      await SiteRepository.findPublishedSlugByLandingShareToken(shareToken)
    if (!slug.ok) return slug
    return ok(slug.value ? publicSiteUrl(slug.value) : null)
  },
}
