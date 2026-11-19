import type {
  BannerAiCopy,
  BannerDocument,
  BannerObjective,
} from '@/src/schemas/crm-banner.schema'

export interface CrmBannerDTO {
  id: string
  workspaceId: string
  name: string
  folder: string
  tags: string[]
  objective: BannerObjective | null
  document: BannerDocument
  createdById: string
  updatedById: string | null
  createdAt: string
  updatedAt: string
}

/** Item da lista: o documento traz só o formato de capa (miniatura). */
export interface CrmBannerListItemDTO extends Omit<CrmBannerDTO, 'document'> {
  document: BannerDocument
  formatCount: number
  formatIds: string[]
}

export interface CrmBannerAiResultDTO {
  variants: BannerAiCopy[]
  imageIdea: string
}
