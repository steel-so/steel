import type { SearchReportIssue } from '@/src/lib/sites/search/analyze'
import type {
  KeywordReportDTO,
  TechnicalItemDTO,
  WorstPageDTO,
} from '@/src/lib/sites/search/seo-overview'
import type { SiteStatusDTO } from '@/types/site'

/** One day of a site's SEO/AEO/GEO history (`day` is `YYYY-MM-DD`). */
export interface SiteSeoHistoryPointDTO {
  day: string
  seo: number
  aeo: number
  geo: number
  /** Mean of the three. */
  overall: number
  issues: number
}

export interface SiteSeoIndexNowDTO {
  enabled: boolean
  /** The site is published, visible to engines and has a key: a manual ping
   * can be sent. */
  canPing: boolean
}

/** A site on the CRM > SEO overview. */
export interface SiteSeoCardDTO {
  id: string
  name: string
  slug: string
  status: SiteStatusDTO
  /** Public address of the site (live after the first publish). */
  url: string
  pageCount: number
  /** The site has pages to score; otherwise the card shows how to start. */
  hasData: boolean
  averages: { seo: number; aeo: number; geo: number }
  overall: number
  /** Failed and warned checks across all pages. */
  issueCount: number
  topIssues: Array<
    Pick<SearchReportIssue, 'checkId' | 'pillar' | 'label' | 'message'> & {
      pageCount: number
    }
  >
  worstPages: WorstPageDTO[]
  technical: { pass: number; warn: number; fail: number; total: number }
  keywordCount: number
  indexNow: SiteSeoIndexNowDTO
  /** Last 30 days. */
  history: SiteSeoHistoryPointDTO[]
  /** Change of the overall score over the history window (null: < 2 days). */
  delta: number | null
}

export interface SiteSeoOverviewDTO {
  generatedAt: string
  sites: SiteSeoCardDTO[]
}

/** Detail of one site: everything the overview shows plus the full lists. */
export interface SiteSeoDetailDTO {
  generatedAt: string
  card: SiteSeoCardDTO
  /** Every page with its three scores. */
  pages: Array<{
    id: string
    title: string
    path: string
    scores: { seo: number; aeo: number; geo: number }
    issues: number
  }>
  issues: SearchReportIssue[]
  technical: TechnicalItemDTO[]
  keywords: KeywordReportDTO[]
  /** Last 90 days. */
  history: SiteSeoHistoryPointDTO[]
}

export interface SiteSeoKeywordDTO {
  id: string
  term: string
}

export interface SiteSeoReindexDTO {
  /** URLs sent to the engines. */
  sent: number
  /** HTTP status of the engine; `null` on a network error. */
  status: number | null
}
