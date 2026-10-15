/** Sites wave S2 (platform): redirects and metrics. */

export interface SiteRedirectDTO {
  id: string
  siteId: string
  /** Normalized source: `/antigo` or a prefix `/blog/*`. */
  fromPath: string
  /** Site path (`/novo`) or absolute URL. */
  toPath: string
  permanent: boolean
  createdAt: string
  updatedAt: string
}

/** One day of a site's metrics (`date` is `YYYY-MM-DD` in the site's
 * timezone). */
export interface SiteAnalyticsDayDTO {
  date: string
  views: number
  visitors: number
  conversions: number
}

export interface SiteAnalyticsCountDTO {
  /** Page path, referrer host, UTM value… (`null`: direct / not set). */
  key: string | null
  /** Page title when `key` is a page of the published site. */
  label?: string | null
  views: number
  visitors: number
}

export interface SiteAnalyticsConversionDTO {
  path: string
  label: string | null
  views: number
  conversions: number
  /** conversions / views (0–1); 0 without views. */
  rate: number
}

export interface SiteAnalyticsDTO {
  siteId: string
  timezone: string
  from: string
  to: string
  totals: {
    views: number
    /** Distinct daily visitor hashes summed over the days (the hash rotates
     * every day, so a visitor is counted once per day). */
    visitors: number
    conversions: number
    /** conversions / views (0–1). */
    conversionRate: number
  }
  /** Same totals for the previous range of the same length. */
  previous: {
    views: number
    visitors: number
    conversions: number
  }
  days: SiteAnalyticsDayDTO[]
  topPages: SiteAnalyticsCountDTO[]
  referrers: SiteAnalyticsCountDTO[]
  utmSources: SiteAnalyticsCountDTO[]
  utmMediums: SiteAnalyticsCountDTO[]
  utmCampaigns: SiteAnalyticsCountDTO[]
  conversionsByPage: SiteAnalyticsConversionDTO[]
}

/** Daily views of one site (list sparkline). */
export interface SiteAnalyticsSummaryItemDTO {
  siteId: string
  /** Views per day, oldest first, one entry per day of the range. */
  views: number[]
  total: number
}

export interface SiteAnalyticsSummaryDTO {
  from: string
  to: string
  sites: SiteAnalyticsSummaryItemDTO[]
}
