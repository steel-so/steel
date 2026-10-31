export type CrmSocialPlatformDTO =
  | 'FACEBOOK'
  | 'INSTAGRAM'
  | 'TIKTOK'
  | 'YOUTUBE'
  | 'GOOGLE_ANALYTICS'
  | 'GOOGLE_ADS'

export type CrmSocialConnectionStatusDTO = 'CONNECTED' | 'EXPIRED' | 'REVOKED'

export interface CrmSocialConnectionDTO {
  id: string
  platform: CrmSocialPlatformDTO
  externalAccountId: string
  accountName: string | null
  scope: string | null
  isPrimary: boolean
  status: CrmSocialConnectionStatusDTO
  expiresAt: string | null
  workspaceId: string
  createdById: string
  updatedById: string | null
  createdAt: string
  updatedAt: string
}

export type CrmScheduledPostStatusDTO =
  | 'DRAFT'
  | 'SCHEDULED'
  | 'PUBLISHING'
  | 'PUBLISHED'
  | 'PARTIALLY_FAILED'
  | 'FAILED'
  | 'CANCELED'
export type CrmScheduledPostTargetStatusDTO =
  | 'PENDING'
  | 'PUBLISHING'
  | 'PUBLISHED'
  | 'FAILED'
  | 'CANCELED'
export type CrmScheduledMediaKindDTO = 'IMAGE' | 'VIDEO'

export interface CrmScheduledPostTargetDTO {
  id: string
  postId: string
  platform: CrmSocialPlatformDTO
  status: CrmScheduledPostTargetStatusDTO
  externalPostId: string | null
  error: string | null
  attempts: number
  publishedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface CrmScheduledPostMediaDTO {
  id: string
  kind: CrmScheduledMediaKindDTO
  contentType: string
  sizeBytes: number
  order: number
}

export interface CrmScheduledPostDTO {
  id: string
  content: string
  title: string | null
  status: CrmScheduledPostStatusDTO
  scheduledFor: string | null
  publishedAt: string | null
  lastError: string | null
  workspaceId: string
  createdById: string
  createdAt: string
  updatedAt: string
  targets?: CrmScheduledPostTargetDTO[]
  media?: CrmScheduledPostMediaDTO[]
}
