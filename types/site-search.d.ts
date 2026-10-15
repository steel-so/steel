import type { ProfileCompleteness } from '@/src/lib/sites/search/business'
import type { SearchReport } from '@/src/lib/sites/search/analyze'
import type { SiteSearchSettingsDTO } from '@/src/schemas/site-search.schema'

/** "Buscadores" of a site: settings plus what the screens show about them. */
export interface SiteSearchSettingsViewDTO {
  settings: SiteSearchSettingsDTO
  /** The business profile was never saved: it shows a draft built from the
   * workspace, the e-mail brand and the site's SEO fields. */
  prefilled: boolean
  completeness: ProfileCompleteness
  published: boolean
  /** Public files of the site (live after the next publish). */
  urls: {
    robots: string
    sitemap: string
    llms: string
    llmsFull: string
    /** IndexNow key file, when IndexNow is on. */
    indexNowKey: string | null
  }
}

/** "Saúde nos buscadores": the three scores of every page of the draft. */
export interface SiteSearchReportDTO extends SearchReport {
  generatedAt: string
  completeness: ProfileCompleteness
}

/** "Como a IA resumiria esta página". */
export interface SiteSearchAiSummaryDTO {
  summary: string
  /** Entities the model recognized (business, place, service…). */
  entities: string[]
  /** Questions the model thinks the page answers. */
  questions: string[]
  /** What would make the page easier to cite (pt-BR). */
  suggestions: string[]
}

/** One reviewed suggestion of "Otimizar com IA" (current → suggested). */
export interface SiteSearchAiSuggestionDTO {
  pageId: string
  pageTitle: string
  title?: { current: string; suggested: string }
  description?: { current: string; suggested: string }
  answers?: Array<{ question: string; current: string; suggested: string }>
}

export interface SiteSearchAiOptimizeDTO {
  items: SiteSearchAiSuggestionDTO[]
  /** Pages the provider failed on (the others still come back). */
  failed: Array<{ pageId: string; pageTitle: string }>
}
