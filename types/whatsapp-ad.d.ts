export interface WhatsAppAdSettingsDTO {
  /** Master switch: off = the webhook ignores the ad `referral` block. */
  enabled: boolean
  /** Opens a CRM lead for a contact that arrives from an ad. */
  createLeads: boolean
  leadOwnerId: string | null
  /** Base text of the lead source; the ad headline is appended to it. */
  leadSource: string
}

/** Where a conversation came from: the ad (or post) the contact clicked. */
export interface WhatsAppAdReferralDTO {
  id: string
  conversationId: string
  sourceType: string
  sourceId: string
  sourceUrl: string | null
  headline: string | null
  body: string | null
  mediaType: string | null
  mediaUrl: string | null
  leadId: string | null
  receivedAt: string
}

export interface WhatsAppAdSpendDTO {
  id: string
  sourceId: string
  label: string | null
  /** `YYYY-MM-DD`, inclusive. */
  periodStart: string
  periodEnd: string
  amount: number
  note: string | null
  createdAt: string
}

/** Funnel and return of one ad (or post) in the report range. */
export interface WhatsAppAdMetricsDTO {
  /** Messages that carried the ad referral. */
  clicks: number
  conversations: number
  contacts: number
  leads: number
  leadsWon: number
  /** Sum of `closedAmount` of the won leads. */
  revenue: number
  /** Typed spend, prorated by the days inside the range. */
  spend: number
  costPerConversation: number | null
  costPerLead: number | null
  /** (revenue - spend) / spend; null without spend. */
  roi: number | null
}

export interface WhatsAppAdReportRowDTO extends WhatsAppAdMetricsDTO {
  sourceId: string
  sourceType: string
  /** Latest headline seen for the ad, else the label of its spend. */
  name: string | null
  sourceUrl: string | null
}

export interface WhatsAppAdReportDTO {
  from: string
  to: string
  totals: WhatsAppAdMetricsDTO
  rows: WhatsAppAdReportRowDTO[]
}
