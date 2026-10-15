import { BETTER_AUTH_SECRET } from '@/lib/env/server'
import { siteRouteCache } from '@/src/cache/site-route.cache'
import { appError } from '@/src/errors/app-error'
import type { SiteLiveForm } from '@/src/lib/canvas-site'
import { err, ok, type Result } from '@/src/lib/result'
import { publicSiteUrl } from '@/src/lib/sites/public-url'
import {
  buildSiteRouteIndex,
  type SiteRouteIndex,
  UNPUBLISHED_ROUTE_INDEX,
} from '@/src/lib/sites/route-index'
import { parseSiteSnapshot, type SiteSnapshot } from '@/src/lib/sites/snapshot'
import { referrerHost, siteVisitorHash } from '@/src/lib/sites/visitor'
import { toCrmFormPublicDTO } from '@/src/mappers/crm-form.mapper'
import { SiteRepository } from '@/src/repositories/site.repository'
import { SiteRedirectRepository } from '@/src/repositories/site-redirect.repository'
import type { RecordSiteViewDTO } from '@/src/schemas/site-view.schema'
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
  ): Promise<Result<Record<string, SiteLiveForm>>> {
    const forms = await SiteRepository.findPublishedForms(workspaceId, tokens)
    if (!forms.ok) return forms
    const byToken: Record<string, SiteLiveForm> = {}
    for (const form of forms.value) {
      const dto = toCrmFormPublicDTO(form)
      byToken[form.publicToken] = {
        fields: dto.fields.map((field) => ({
          key: field.key,
          label: field.label,
          type: field.type,
          required: field.required,
          ...(field.placeholder ? { placeholder: field.placeholder } : {}),
          ...(field.options ? { options: field.options } : {}),
        })),
        successMessage: dto.successMessage,
        redirectUrl: dto.redirectUrl,
      }
    }
    return ok(byToken)
  },

  /** Anonymous page view or form conversion (see `siteVisitorHash`). The
   * runtime only sends it when the visitor accepted the site's cookie
   * banner, or when the site has none (nothing is stored on the device
   * either way). */
  async recordView(
    slug: string,
    request: {
      ip: string
      userAgent: string
      host: string | null
      now?: Date
    },
    dto: Omit<RecordSiteViewDTO, 'kind'> & {
      kind?: RecordSiteViewDTO['kind']
    },
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
      kind: dto.kind ?? 'VIEW',
      formToken: dto.kind === 'CONVERSION' ? dto.formToken : undefined,
    })
  },

  /** Public paths and redirects of a site (see `SiteRouteIndex`), read
   * through Redis. An unknown or unpublished site is an index with
   * `published: false`; a database failure is an error (the proxy then
   * lets the page decide). */
  async routeIndex(slug: string): Promise<Result<SiteRouteIndex>> {
    const cached = await siteRouteCache.get(slug)
    if (cached) return ok(cached)

    const published = await SitePublicService.getPublished(slug)
    if (!published.ok) {
      if (published.error.code !== 'SITE_NOT_FOUND') return published
      await siteRouteCache.set(slug, UNPUBLISHED_ROUTE_INDEX)
      return ok(UNPUBLISHED_ROUTE_INDEX)
    }
    const redirects = await SiteRedirectRepository.listBySiteSlug(slug)
    if (!redirects.ok) return redirects

    const index = buildSiteRouteIndex(
      published.value.snapshot,
      redirects.value.map((redirect) => ({
        fromPath: redirect.fromPath,
        toPath: redirect.toPath,
        permanent: redirect.permanent,
      })),
    )
    await siteRouteCache.set(slug, index)
    return ok(index)
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
