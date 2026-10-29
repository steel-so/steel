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
import { CrmNewsletterRepository } from '@/src/repositories/crm-newsletter.repository'
import { SiteRepository } from '@/src/repositories/site.repository'
import { SiteRedirectRepository } from '@/src/repositories/site-redirect.repository'
import { crmFormNewsletterConsentText } from '@/src/schemas/crm-newsletter.schema'
import type { RecordSiteViewDTO } from '@/src/schemas/site-view.schema'
import { assertModuleEnabled } from './authz'
import { CrmCampaignTrackingService } from './crm-campaign-tracking.service'
import { SiteBlogPublicService } from './site-blog-public.service'

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
    // Forms that subscribe to a newsletter show the consent box only while
    // the newsletter is ACTIVE (same rule as the public form page).
    const activeNewsletters = new Map<string, string>()
    if (forms.value.some((form) => form.newsletterId)) {
      const newsletters =
        await CrmNewsletterRepository.listActiveByWorkspace(workspaceId)
      if (!newsletters.ok) return newsletters
      for (const newsletter of newsletters.value) {
        activeNewsletters.set(newsletter.id, newsletter.name)
      }
    }
    const byToken: Record<string, SiteLiveForm> = {}
    for (const form of forms.value) {
      const dto = toCrmFormPublicDTO(form)
      const newsletterName = form.newsletterId
        ? activeNewsletters.get(form.newsletterId)
        : undefined
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
        ...(newsletterName && {
          newsletter: {
            name: newsletterName,
            consentText: crmFormNewsletterConsentText(newsletterName),
          },
        }),
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

    const now = request.now ?? new Date()
    const visitorHash = siteVisitorHash({
      ip: request.ip,
      userAgent: request.userAgent,
      siteId: published.value.id,
      secret: BETTER_AUTH_SECRET,
      now,
    })
    const recorded = await SiteRepository.recordView({
      siteId: published.value.id,
      pageId,
      path: dto.path,
      visitorHash,
      referrer: referrerHost(dto.referrer, request.host),
      utmSource: dto.utmSource,
      utmMedium: dto.utmMedium,
      utmCampaign: dto.utmCampaign,
      utmTerm: dto.utmTerm,
      utmContent: dto.utmContent,
      kind: dto.kind ?? 'VIEW',
      formToken: dto.kind === 'CONVERSION' ? dto.formToken : undefined,
    })
    if (!recorded.ok) return recorded

    // CRM campaign attribution of the view (best-effort). The runtime only
    // sends the beacon when the visitor's consent allows, and one view per
    // visitor, page and day counts (the hash rotates daily). Form
    // conversions are attributed by the form submission itself.
    if ((dto.kind ?? 'VIEW') === 'VIEW' && (dto.ref || dto.utmCampaign)) {
      await CrmCampaignTrackingService.attribute(
        {
          workspaceId: published.value.workspaceId,
          kind: 'SITE_VIEW',
          sourceRef: `${visitorHash}:${pageId ?? dto.path}`,
          ref: {
            ref: dto.ref,
            utmCampaign: dto.utmCampaign,
            utmSource: dto.utmSource,
          },
          siteId: published.value.id,
          sitePageId: pageId ?? undefined,
        },
        now,
      )
    }
    return ok(undefined)
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
    // Blog posts, archives and collection items answer 200 too.
    const dynamic = await SiteBlogPublicService.routePaths(
      published.value.id,
      published.value.snapshot,
      new Date(),
    )
    if (!dynamic.ok) return dynamic

    const index = buildSiteRouteIndex(
      published.value.snapshot,
      redirects.value.map((redirect) => ({
        fromPath: redirect.fromPath,
        toPath: redirect.toPath,
        permanent: redirect.permanent,
      })),
      dynamic.value,
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
