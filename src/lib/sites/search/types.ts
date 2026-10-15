import type { CanvasOp } from '@/src/lib/canvas/ops'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import type { SiteSettingsDTO } from '@/src/schemas/site.schema'
import type { SitePageSeoDTO } from '@/src/schemas/site-page.schema'
import type {
  SearchAiField,
  SearchContentDTO,
} from '@/src/schemas/site-search.schema'

/** Classic search (Google/Bing), answer engines, generative engines. */
export type SearchPillar = 'seo' | 'aeo' | 'geo'

export const SEARCH_PILLARS: SearchPillar[] = ['seo', 'aeo', 'geo']

export const SEARCH_PILLAR_LABELS: Record<SearchPillar, string> = {
  seo: 'SEO',
  aeo: 'AEO',
  geo: 'GEO',
}

export type SearchCheckStatus = 'pass' | 'warn' | 'fail'

/** Where an "open" fix sends the user. */
export type SearchFixTarget =
  | 'keyword'
  | 'questions'
  | 'summary'
  | 'structured'
  | 'business'
  | 'crawlers'
  | 'page-settings'

/** One-click fix of a check. */
export type SearchFix =
  /** Patch of the page's SEO (title, description, search data). */
  | {
      kind: 'patch'
      label: string
      set: {
        title?: string
        description?: string
        search?: Partial<SearchContentDTO>
      }
    }
  /** Canvas operations on the page document (undoable). */
  | { kind: 'canvas'; label: string; ops: CanvasOp[] }
  /** Selects the node to fix in the inspector. */
  | { kind: 'select'; label: string; nodeId: string }
  /** Inserts "Perguntas que este conteúdo responde" as an accordion. */
  | { kind: 'insert-faq'; label: string }
  /** Inserts the quotable summary below the H1. */
  | { kind: 'insert-summary'; label: string }
  | { kind: 'open'; label: string; target: SearchFixTarget }
  /** Writes it with the CRM AI provider (quota-aware). */
  | { kind: 'ai'; label: string; field: SearchAiField }

export interface SearchCheck {
  id: string
  pillar: SearchPillar
  /** Short name of the check. */
  label: string
  status: SearchCheckStatus
  /** Impact on the pillar's score. */
  weight: number
  /** pt-BR explanation of the result. */
  message: string
  fix?: SearchFix
}

export interface SearchPillarResult {
  /** 0–100. */
  score: number
  checks: SearchCheck[]
}

export type SearchPageAnalysis = Record<SearchPillar, SearchPillarResult>

/** The page being analyzed (a site page; a blog post maps to the same). */
export interface SearchPageInput {
  page: {
    id: string
    title: string
    slug: string
    isHome: boolean
    seo: SitePageSeoDTO
    /** ISO date of the last edit (freshness). */
    updatedAt?: string
  }
  document: CanvasDocument
  site: {
    name: string
    settings: SiteSettingsDTO
    /** Public URL of the page. */
    pageUrl: string
  }
  /** Other pages of the site (duplicate titles and descriptions). */
  siblings: Array<{ id: string; title: string; seo: SitePageSeoDTO }>
  /** Readable text of the header and footer (NAP consistency). */
  chromeText?: string
  now: Date
}
