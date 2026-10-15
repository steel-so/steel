export type CrmCampaignStatusDTO =
  | 'DRAFT'
  | 'SCHEDULED'
  | 'SENDING'
  | 'PAUSED'
  | 'COMPLETED'
  | 'CANCELED'
  | 'FAILED'

export type CrmCampaignDestinationTypeDTO = 'LANDING_PAGE' | 'FORM' | 'SITE_PAGE'

export type CrmCampaignConversionKindDTO =
  | 'LANDING_VIEW'
  | 'FORM_SUBMISSION'
  | 'SITE_VIEW'
  | 'SITE_FORM_SUBMISSION'

export type CrmCampaignLegalBasisDTO =
  | 'CONSENT'
  | 'LEGITIMATE_INTEREST'
  | 'CONTRACT'

export type CrmCampaignDeliveryStatusDTO =
  | 'NONE'
  | 'PENDING'
  | 'SENDING'
  | 'SENT'
  | 'FAILED'
  | 'SKIPPED'

export type CrmCampaignChannelDTO = 'EMAIL' | 'WHATSAPP'

export type CrmCampaignWizardStep = 'destination' | 'content' | 'audience'

export interface CrmCampaignAudienceDTO {
  mailingListIds: string[]
  allPeople: boolean
  leadStages: string[]
}

export type CrmCampaignVariableSourceKind =
  | 'name'
  | 'first_name'
  | 'link'
  | 'link_code'
  | 'static'

export interface CrmCampaignVariableSourceDTO {
  source: CrmCampaignVariableSourceKind
  value?: string
}

export interface CrmCampaignWhatsAppVariablesDTO {
  header: Record<string, CrmCampaignVariableSourceDTO>
  body: Record<string, CrmCampaignVariableSourceDTO>
  buttons: Record<string, CrmCampaignVariableSourceDTO>
}

/** Something missing before the campaign can be launched. */
export interface CrmCampaignIssueDTO {
  step: CrmCampaignWizardStep
  message: string
}

export interface CrmCampaignLinksDTO {
  /** Destination public URL, without parameters. */
  destination: string | null
  /** Destination URL with the e-mail UTM parameters. */
  email: string | null
  /** Destination URL with the WhatsApp UTM parameters. */
  whatsapp: string | null
}

/** What the campaign links to, as shown in summaries. */
export interface CrmCampaignDestinationDTO {
  type: CrmCampaignDestinationTypeDTO
  /** Site, form or landing page name. */
  name: string
  /** Site page title (SITE_PAGE). */
  pageTitle: string | null
  /** Public URL without the campaign parameters. */
  url: string | null
  published: boolean
}

/** One line of the e-mail pre-send checklist (v2 templates). */
export interface CrmCampaignChecklistItemDTO {
  level: 'error' | 'warning'
  message: string
}

export interface CrmCampaignDTO {
  id: string
  workspaceId: string
  name: string
  slug: string
  status: CrmCampaignStatusDTO
  destinationType: CrmCampaignDestinationTypeDTO | null
  landingPageId: string | null
  formId: string | null
  siteId: string | null
  sitePageId: string | null
  utmMedium: string
  emailFrom: string | null
  emailSubject: string | null
  emailPreheader: string | null
  emailTemplateId: string | null
  emailLegalBasis: CrmCampaignLegalBasisDTO | null
  audience: CrmCampaignAudienceDTO
  whatsappEnabled: boolean
  whatsappConnectionId: string | null
  whatsappTemplateId: string | null
  whatsappVariables: CrmCampaignWhatsAppVariablesDTO | null
  whatsappText: string | null
  whatsappMediaUrl: string | null
  whatsappQuickReplyId: string | null
  whatsappDelayHours: number
  whatsappLegalBasis: CrmCampaignLegalBasisDTO | null
  scheduledAt: string | null
  sendWindowStartHour: number | null
  sendWindowEndHour: number | null
  sendWeekdaysOnly: boolean
  consentConfirmedAt: string | null
  launchedAt: string | null
  startAt: string | null
  completedAt: string | null
  createdById: string
  createdAt: string
  updatedAt: string
  links: CrmCampaignLinksDTO
  destination: CrmCampaignDestinationDTO | null
}

export interface CrmCampaignDetailDTO extends CrmCampaignDTO {
  issues: CrmCampaignIssueDTO[]
  /** Checklist of the chosen e-mail template (errors also block the
   * launch through `issues`). */
  emailChecklist: CrmCampaignChecklistItemDTO[]
}

export interface CrmCampaignKpisDTO {
  recipients: number
  emailSent: number
  emailOpened: number
  emailClicked: number
  whatsappSent: number
  whatsappRead: number
  whatsappReplied: number
  conversions: number
}

export interface CrmCampaignListItemDTO extends CrmCampaignDTO {
  kpis: CrmCampaignKpisDTO
}

export interface CrmCampaignEmailFunnelDTO {
  eligible: number
  pending: number
  sent: number
  delivered: number
  opened: number
  clicked: number
  failed: number
  skipped: number
  bounced: number
  unsubscribed: number
}

export interface CrmCampaignWhatsAppFunnelDTO {
  eligible: number
  pending: number
  sent: number
  delivered: number
  read: number
  clicked: number
  replied: number
  failed: number
  skipped: number
}

export interface CrmCampaignConvertedContactDTO {
  id: string
  kind: CrmCampaignConversionKindDTO
  channel: CrmCampaignChannelDTO | null
  recipientId: string | null
  name: string | null
  leadId: string | null
  personId: string | null
  createdAt: string
}

export interface CrmCampaignStatsDTO {
  recipients: number
  email: CrmCampaignEmailFunnelDTO
  whatsapp: CrmCampaignWhatsAppFunnelDTO
  conversions: {
    total: number
    visits: number
    submissions: number
    byChannel: { email: number; whatsapp: number; unknown: number }
    /** Split by where it happened. */
    byDestination: {
      siteView: number
      siteForm: number
      crmForm: number
      landingView: number
    }
  }
  convertedContacts: CrmCampaignConvertedContactDTO[]
}

export interface CrmCampaignRecipientDTO {
  id: string
  name: string
  email: string | null
  waId: string | null
  personId: string | null
  leadId: string | null
  emailStatus: CrmCampaignDeliveryStatusDTO
  emailSkipReason: string | null
  emailError: string | null
  emailSentAt: string | null
  emailDeliveredAt: string | null
  emailOpenedAt: string | null
  emailClickedAt: string | null
  emailBouncedAt: string | null
  unsubscribedAt: string | null
  whatsappStatus: CrmCampaignDeliveryStatusDTO
  whatsappSkipReason: string | null
  whatsappError: string | null
  whatsappSentAt: string | null
  whatsappDeliveredAt: string | null
  whatsappReadAt: string | null
  whatsappClickedAt: string | null
  whatsappRepliedAt: string | null
  conversationId: string | null
  convertedAt: string | null
}

export interface CrmCampaignRecipientPageDTO {
  items: CrmCampaignRecipientDTO[]
  total: number
  page: number
  pageSize: number
}

export interface CrmCampaignChannelReachDTO {
  reachable: number
  optedOut: number
  missing: number
}

export interface CrmCampaignAudiencePreviewDTO {
  total: number
  email: CrmCampaignChannelReachDTO
  whatsapp: CrmCampaignChannelReachDTO
}

export interface CrmCampaignTemplateFieldsDTO {
  headerVariables: number
  bodyVariables: number
  bodyText: string
  /** Indexes of URL buttons with a dynamic `{{1}}` suffix. */
  urlButtons: number[]
}

export type CrmCampaignTemplateQualityDTO =
  | 'GREEN'
  | 'YELLOW'
  | 'RED'
  | 'UNKNOWN'

/** A template button as the campaign shows it. */
export interface CrmCampaignTemplateButtonDTO {
  type: 'REPLY' | 'URL'
  label: string
  /** URL buttons: the URL (with `{{1}}` when dynamic). */
  url: string | null
  /** URL button whose suffix is a variable (mapped to the campaign link). */
  dynamic: boolean
  /** Reply buttons: how many actions run on click. */
  actionCount: number
}

export interface CrmCampaignWhatsAppTemplateOptionDTO {
  id: string
  name: string
  language: string
  category: string
  status: 'APPROVED' | 'PAUSED' | 'DISABLED'
  quality: CrmCampaignTemplateQualityDTO
  /** Media header format (IMAGE/VIDEO/DOCUMENT) or TEXT. */
  headerFormat: 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | null
  headerMediaUrl: string | null
  buttons: CrmCampaignTemplateButtonDTO[]
  /** pt-BR reason when the template cannot be used (red, paused, disabled). */
  blockedReason: string | null
  fields: CrmCampaignTemplateFieldsDTO
}

/** Z-API quick reply usable as campaign content. */
export interface CrmCampaignQuickReplyOptionDTO {
  id: string
  shortcut: string
  title: string
  body: string
  mediaUrl: string | null
  buttons: CrmCampaignTemplateButtonDTO[]
}

export interface CrmCampaignWhatsAppConnectionOptionDTO {
  id: string
  label: string
  provider: 'META' | 'ZAPI'
  phoneNumber: string
  /** Approved templates, plus paused/disabled ones shown blocked (Meta). */
  templates: CrmCampaignWhatsAppTemplateOptionDTO[]
}

export interface CrmCampaignSitePageOptionDTO {
  id: string
  title: string
  /** Public path (`''` = home). */
  path: string
  url: string
  isHome: boolean
}

export interface CrmCampaignSiteOptionDTO {
  id: string
  name: string
  slug: string
  /** Public address of the home page. */
  url: string
  published: boolean
  updatedAt: string
  /** Live pages (empty when not published). */
  pages: CrmCampaignSitePageOptionDTO[]
}

/** Where a form is embedded (published site pages). */
export interface CrmCampaignFormEmbedDTO {
  siteId: string
  siteName: string
  pageId: string
  pageTitle: string
  url: string
}

export interface CrmCampaignOptionsDTO {
  baseUrl: string
  sites: CrmCampaignSiteOptionDTO[]
  /** Legacy landing pages not migrated to Sites yet (the chosen one is
   * always listed). */
  landingPages: {
    id: string
    title: string
    published: boolean
    shareToken: string
  }[]
  forms: {
    id: string
    name: string
    published: boolean
    publicToken: string
    /** Public link (`/f/<token>`). */
    url: string
    embeds: CrmCampaignFormEmbedDTO[]
  }[]
  emailTemplates: {
    id: string
    name: string
    subject: string
    /** v2 = Steel Canvas ("Novo editor"), v1 = locked layouts, html = free HTML. */
    editor: 'v2' | 'v1' | 'html'
    updatedAt: string
  }[]
  mailingLists: { id: string; name: string }[]
  whatsapp: {
    available: boolean
    /** pt-BR reason when unavailable. */
    reason: string | null
    connections: CrmCampaignWhatsAppConnectionOptionDTO[]
    /** Quick replies (Z-API content with buttons). */
    quickReplies: CrmCampaignQuickReplyOptionDTO[]
  }
}

export interface CrmCampaignEmailPreviewDTO {
  subject: string
  html: string
  text: string
}

export type CrmCampaignTestOutcomeDTO = 'sent' | 'failed'

export interface CrmCampaignTestSendResultDTO {
  email: CrmCampaignTestOutcomeDTO | null
  whatsapp: CrmCampaignTestOutcomeDTO | null
  errors: string[]
}
