import type {
  CrmLandingPageSectionContent,
  CrmLandingPageSectionType,
} from '@/src/schemas/crm-landing-page-section.schema'

export type CrmLandingPageStatusDTO = 'DRAFT' | 'PUBLISHED'

export interface CrmLandingPageSectionDTO {
  id: string
  type: CrmLandingPageSectionType
  order: number
  enabled: boolean
  content: CrmLandingPageSectionContent
}

export interface CrmLandingPageDTO {
  id: string
  title: string
  templateKey: string
  status: CrmLandingPageStatusDTO
  shareToken: string
  viewsCount: number
  sections: CrmLandingPageSectionDTO[]
  publishedAt: string | null
  workspaceId: string
  createdById: string
  updatedById: string | null
  position: number
  createdAt: string
  updatedAt: string
}

export interface CrmLandingPagePublicDTO {
  title: string
  templateKey: string
  sections: CrmLandingPageSectionDTO[]
}

export interface CrmLandingPageViewDTO {
  id: string
  landingPageId: string
  viewId: string
  ipHash: string
  durationMs: number
  ctaClicks: number
  referrer: string | null
  createdAt: string
  updatedAt: string
}
