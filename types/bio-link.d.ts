import type { BioBlockDTO, BioThemeDTO } from '@/src/schemas/bio-link.schema'

export type BioLinkStatusDTO = 'DRAFT' | 'PUBLISHED'

export interface BioLinkDTO {
  id: string
  workspaceId: string
  name: string
  slug: string
  status: BioLinkStatusDTO
  title: string | null
  description: string | null
  avatarUrl: string | null
  theme: BioThemeDTO
  blocks: BioBlockDTO[]
  noIndex: boolean
  publishedAt: string | null
  /** Public address (`<app>/b/<slug>`). */
  url: string
  createdAt: string
  updatedAt: string
}

/** Row of the list: no theme or block payload. */
export interface BioLinkSummaryDTO {
  id: string
  name: string
  slug: string
  status: BioLinkStatusDTO
  avatarUrl: string | null
  url: string
  /** Buttons and videos the page holds. */
  linkCount: number
  /** All-time totals. */
  views: number
  clicks: number
  updatedAt: string
}

export interface BioCountDTO {
  key: string | null
  count: number
}

export interface BioLinkClickDTO {
  linkId: string
  /** Title of the block now, or when it was last clicked if it was removed. */
  title: string
  clicks: number
  /** `false` once the block was removed from the page. */
  exists: boolean
}

export interface BioLinkAnalyticsDTO {
  bioLinkId: string
  timezone: string
  from: string
  to: string
  totals: {
    views: number
    visitors: number
    clicks: number
    /** Clicks over views, 0 to 1. */
    clickRate: number
  }
  daily: { day: string; views: number; clicks: number }[]
  links: BioLinkClickDTO[]
  referrers: BioCountDTO[]
  sources: BioCountDTO[]
  countries: BioCountDTO[]
  devices: BioCountDTO[]
}

/** Choices for the editor's ready-made buttons. */
export interface BioLinkOptionsDTO {
  whatsapp: { id: string; label: string; phone: string }[]
  sites: { id: string; name: string; url: string }[]
  forms: { id: string; name: string; publicToken: string }[]
}

/** What the public page renders (the draft is never exposed). */
export interface BioLinkPublicDTO {
  id: string
  workspaceId: string
  slug: string
  title: string
  description: string | null
  avatarUrl: string | null
  theme: BioThemeDTO
  blocks: BioBlockDTO[]
  noIndex: boolean
}
