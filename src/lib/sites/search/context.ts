import type { SiteSettingsDTO } from '@/src/schemas/site.schema'
import {
  DEFAULT_SITE_SEARCH_SETTINGS,
  parseSearchContent,
  type SearchContentDTO,
  type SiteBusinessProfileDTO,
  type SiteSearchSettingsDTO,
} from '@/src/schemas/site-search.schema'
import { extractPageContent, type PageContent } from './content'
import type { SearchPageInput } from './types'

/** Everything the checks read, resolved once per page. */
export interface CheckContext {
  input: SearchPageInput
  content: PageContent
  search: SearchContentDTO
  settings: SiteSearchSettingsDTO
  business: SiteBusinessProfileDTO
  keyword: string | null
  /** Keyword plus synonyms. */
  terms: string[]
  /** `<title>` as published (with the site's template). */
  title: string
  /** Meta description as published (page, else the site's). */
  description: string
}

/** Search settings of a site with their defaults. */
export function searchSettingsOf(
  settings: SiteSettingsDTO,
): SiteSearchSettingsDTO {
  return settings.search ?? DEFAULT_SITE_SEARCH_SETTINGS
}

/**
 * Business profile with the site's older SEO fields as fallbacks
 * (organization name, logo, social profiles, description).
 */
export function resolveBusinessProfile(
  settings: SiteSettingsDTO,
  siteName: string,
): SiteBusinessProfileDTO {
  const business = searchSettingsOf(settings).business
  const sameAs = business.sameAs?.length ? business.sameAs : settings.seo.sameAs
  const logoUrl =
    business.logoUrl ?? settings.seo.logoUrl ?? settings.faviconUrl
  const description = business.description ?? settings.seo.description
  return {
    ...business,
    name: business.name || settings.seo.organizationName || siteName,
    ...(logoUrl ? { logoUrl } : {}),
    ...(sameAs?.length ? { sameAs } : {}),
    ...(description ? { description } : {}),
  }
}

/** Title with the site's template (`%s | Site`). */
export function renderedTitle(
  settings: SiteSettingsDTO,
  page: { title: string; seo: { title?: string } },
): string {
  const title = page.seo.title || page.title
  const template = settings.seo.titleTemplate
  return template?.includes('%s') ? template.replace('%s', title) : title
}

export function buildCheckContext(input: SearchPageInput): CheckContext {
  const search = parseSearchContent(input.page.seo.search)
  const keyword = search.focusKeyword?.trim() || null
  const settings = searchSettingsOf(input.site.settings)
  return {
    input,
    content: extractPageContent(input.document),
    search,
    settings,
    business: resolveBusinessProfile(input.site.settings, input.site.name),
    keyword,
    terms: keyword ? [keyword, ...(search.synonyms ?? [])] : [],
    title: renderedTitle(input.site.settings, input.page),
    description:
      input.page.seo.description || input.site.settings.seo.description || '',
  }
}
