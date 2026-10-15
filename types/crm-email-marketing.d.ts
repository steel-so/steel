import type {
  EmailBuilderDocument,
  EmailCanvasDocument,
} from '@/src/schemas/crm-email-builder.schema'

export interface CrmEmailTemplateDTO {
  id: string
  name: string
  subject: string
  contentHtml: string
  contentJson: string | null
  templateId: string | null
  templateProps: Record<string, string> | null
  /** LEGACY = free HTML/old layout; BUILDER = visual editor document. */
  kind: 'LEGACY' | 'BUILDER'
  /** v1 (locked layout) or v2 (Steel Canvas — open both with
   * `openEmailDocument` from src/lib/canvas-email/convert-v1). */
  builderDocument: EmailBuilderDocument | EmailCanvasDocument | null
  contentText: string | null
  workspaceId: string
  createdById: string
  updatedById: string | null
  createdAt: string
  updatedAt: string
}

export type CrmCampaignStatusDTO =
  | 'DRAFT'
  | 'SCHEDULED'
  | 'SENDING'
  | 'SENT'
  | 'FAILED'
export type CrmCampaignRecipientScopeDTO = 'ALL' | 'SELECTED'
export type CrmCampaignRecipientStatusDTO =
  | 'PENDING'
  | 'SENT'
  | 'FAILED'
  | 'SKIPPED'

export interface CrmEmailCampaignDTO {
  id: string
  subject: string
  contentHtml: string
  contentJson: string | null
  fromAddress: string
  status: CrmCampaignStatusDTO
  recipientScope: CrmCampaignRecipientScopeDTO
  recipientCount: number
  sentCount: number
  failedCount: number
  /** Descadastrados (opt-out LGPD) entre a criação e o envio — não enviados. */
  skippedCount: number
  scheduledAt: string | null
  sentAt: string | null
  /** Visual-builder template the campaign was rendered from. */
  templateId: string | null
  campaignLink: string | null
  workspaceId: string
  createdById: string
  createdAt: string
  updatedAt: string
}

export interface CrmEmailCampaignRecipientDTO {
  id: string
  campaignId: string
  personId: string | null
  email: string
  name: string | null
  status: CrmCampaignRecipientStatusDTO
  providerMessageId: string | null
  errorMessage: string | null
  sentAt: string | null
  createdAt: string
}

export interface CrmMailingListDTO {
  id: string
  name: string
  description: string | null
  memberCount: number
  workspaceId: string
  createdById: string
  createdAt: string
  updatedAt: string
}

export interface CrmMailingListMemberDTO {
  id: string
  mailingListId: string
  email: string
  name: string | null
  personId: string | null
  createdAt: string
}

/** Descadastro LGPD de campanhas (endereço + pessoa vinculada, quando houver). */
export interface CrmEmailOptOutDTO {
  id: string
  email: string
  personId: string | null
  campaignId: string | null
  source: 'LINK' | 'ONE_CLICK'
  createdAt: string
}

/** Resultado público da página de descadastro — sem dados do workspace. */
export interface CrmEmailUnsubscribeResultDTO {
  email: string
  alreadyOptedOut: boolean
}

/** Workspace branding of the visual e-mail builder (resolved with defaults). */
export interface CrmEmailBrandDTO {
  companyName: string
  logoUrl: string
  primaryColor: string
  address: string
  website: string
  /** `false` while the workspace never saved a brand (defaults shown). */
  saved: boolean
  updatedAt: string | null
}

/** A builder template rendered for one contact. */
export interface CrmEmailRenderDTO {
  subject: string
  html: string
  text: string
}

/** Quick picks of the link picker: published landing pages and forms. */
export interface CrmEmailLinkTargetsDTO {
  landingPages: { id: string; title: string; url: string }[]
  forms: { id: string; name: string; url: string }[]
}

export interface CrmEmailTestSendDTO {
  to: string
}
