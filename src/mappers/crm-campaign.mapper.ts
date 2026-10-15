import type {
  CrmCampaign,
  CrmCampaignConversion,
  CrmCampaignConversionKind,
  CrmCampaignRecipient,
} from '@prisma/client'
import {
  campaignDestinationUrl,
  withCampaignParams,
} from '@/src/lib/crm-campaign/campaign-url'
import type { CampaignFunnelCounts } from '@/src/repositories/crm-campaign.repository'
import type {
  CrmCampaignAudienceDTO,
  CrmCampaignConvertedContactDTO,
  CrmCampaignDestinationDTO,
  CrmCampaignDTO,
  CrmCampaignKpisDTO,
  CrmCampaignLinksDTO,
  CrmCampaignRecipientDTO,
  CrmCampaignStatsDTO,
  CrmCampaignWhatsAppVariablesDTO,
} from '@/types/crm-campaign'

const iso = (date: Date | null) => (date ? date.toISOString() : null)

export function toCrmCampaignAudienceDTO(raw: unknown): CrmCampaignAudienceDTO {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Partial<
    Record<keyof CrmCampaignAudienceDTO, unknown>
  >
  const strings = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  return {
    mailingListIds: strings(value.mailingListIds),
    allPeople: value.allPeople === true,
    leadStages: strings(value.leadStages),
  }
}

/**
 * Public links of the destination, with the UTM parameters per channel.
 * `destination` is the landing page/form token, or the resolved URL of a
 * site page (`{ url }`).
 */
export function toCrmCampaignLinks(
  campaign: Pick<CrmCampaign, 'destinationType' | 'slug' | 'utmMedium'>,
  baseUrl: string,
  destination: string | { url: string } | null,
): CrmCampaignLinksDTO {
  const type = campaign.destinationType
  const usable =
    type !== null &&
    destination !== null &&
    (type === 'SITE_PAGE') === (typeof destination === 'object')
  if (!usable) return { destination: null, email: null, whatsapp: null }
  const destinationUrl = campaignDestinationUrl(
    baseUrl,
    typeof destination === 'string'
      ? { type: type as 'LANDING_PAGE' | 'FORM', token: destination }
      : { type: 'SITE_PAGE', url: destination.url },
  )
  const params = { medium: campaign.utmMedium, campaign: campaign.slug }
  return {
    destination: destinationUrl,
    email: withCampaignParams(destinationUrl, { ...params, source: 'email' }),
    whatsapp: withCampaignParams(destinationUrl, {
      ...params,
      source: 'whatsapp',
    }),
  }
}

export function toCrmCampaignDTO(
  campaign: CrmCampaign,
  links: CrmCampaignLinksDTO,
  destination: CrmCampaignDestinationDTO | null = null,
): CrmCampaignDTO {
  return {
    id: campaign.id,
    workspaceId: campaign.workspaceId,
    name: campaign.name,
    slug: campaign.slug,
    status: campaign.status,
    destinationType: campaign.destinationType,
    landingPageId: campaign.landingPageId,
    formId: campaign.formId,
    siteId: campaign.siteId,
    sitePageId: campaign.sitePageId,
    utmMedium: campaign.utmMedium,
    emailFrom: campaign.emailFrom,
    emailSubject: campaign.emailSubject,
    emailPreheader: campaign.emailPreheader,
    emailTemplateId: campaign.emailTemplateId,
    emailLegalBasis: campaign.emailLegalBasis,
    audience: toCrmCampaignAudienceDTO(campaign.audience),
    whatsappEnabled: campaign.whatsappEnabled,
    whatsappConnectionId: campaign.whatsappConnectionId,
    whatsappTemplateId: campaign.whatsappTemplateId,
    whatsappVariables:
      (campaign.whatsappVariables as CrmCampaignWhatsAppVariablesDTO | null) ??
      null,
    whatsappText: campaign.whatsappText,
    whatsappMediaUrl: campaign.whatsappMediaUrl,
    whatsappQuickReplyId: campaign.whatsappQuickReplyId,
    whatsappDelayHours: campaign.whatsappDelayHours,
    whatsappLegalBasis: campaign.whatsappLegalBasis,
    scheduledAt: iso(campaign.scheduledAt),
    sendWindowStartHour: campaign.sendWindowStartHour,
    sendWindowEndHour: campaign.sendWindowEndHour,
    sendWeekdaysOnly: campaign.sendWeekdaysOnly,
    consentConfirmedAt: iso(campaign.consentConfirmedAt),
    launchedAt: iso(campaign.launchedAt),
    startAt: iso(campaign.startAt),
    completedAt: iso(campaign.completedAt),
    createdById: campaign.createdById,
    createdAt: campaign.createdAt.toISOString(),
    updatedAt: campaign.updatedAt.toISOString(),
    links,
    destination,
  }
}

export function toCrmCampaignKpisDTO(
  funnel: CampaignFunnelCounts | undefined,
): CrmCampaignKpisDTO {
  return {
    recipients: funnel?.recipients ?? 0,
    emailSent: funnel?.email.SENT ?? 0,
    emailOpened: funnel?.email.opened ?? 0,
    emailClicked: funnel?.email.clicked ?? 0,
    whatsappSent: funnel?.whatsapp.SENT ?? 0,
    whatsappRead: funnel?.whatsapp.read ?? 0,
    whatsappReplied: funnel?.whatsapp.replied ?? 0,
    conversions: funnel?.conversions ?? 0,
  }
}

export function toCrmCampaignStatsDTO(
  funnel: CampaignFunnelCounts,
  conversionCounts: {
    kind: CrmCampaignConversionKind
    channel: 'EMAIL' | 'WHATSAPP' | null
    count: number
  }[],
  recent: (CrmCampaignConversion & { recipient: { name: string } | null })[],
): CrmCampaignStatsDTO {
  const { email, whatsapp } = funnel
  const sum = (pick: (row: (typeof conversionCounts)[number]) => boolean) =>
    conversionCounts.filter(pick).reduce((acc, row) => acc + row.count, 0)
  return {
    recipients: funnel.recipients,
    email: {
      eligible: funnel.recipients - email.NONE,
      pending: email.PENDING + email.SENDING,
      sent: email.SENT,
      delivered: email.delivered,
      opened: email.opened,
      clicked: email.clicked,
      failed: email.FAILED,
      skipped: email.SKIPPED,
      bounced: email.bounced,
      unsubscribed: email.unsubscribed,
    },
    whatsapp: {
      eligible: funnel.recipients - whatsapp.NONE,
      pending: whatsapp.PENDING + whatsapp.SENDING,
      sent: whatsapp.SENT,
      delivered: whatsapp.delivered,
      read: whatsapp.read,
      clicked: whatsapp.clicked,
      replied: whatsapp.replied,
      failed: whatsapp.FAILED,
      skipped: whatsapp.SKIPPED,
    },
    conversions: {
      total: sum(() => true),
      visits: sum(
        (row) => row.kind === 'LANDING_VIEW' || row.kind === 'SITE_VIEW',
      ),
      submissions: sum(
        (row) =>
          row.kind === 'FORM_SUBMISSION' || row.kind === 'SITE_FORM_SUBMISSION',
      ),
      byChannel: {
        email: sum((row) => row.channel === 'EMAIL'),
        whatsapp: sum((row) => row.channel === 'WHATSAPP'),
        unknown: sum((row) => row.channel === null),
      },
      byDestination: {
        siteView: sum((row) => row.kind === 'SITE_VIEW'),
        siteForm: sum((row) => row.kind === 'SITE_FORM_SUBMISSION'),
        crmForm: sum((row) => row.kind === 'FORM_SUBMISSION'),
        landingView: sum((row) => row.kind === 'LANDING_VIEW'),
      },
    },
    convertedContacts: recent.map(toCrmCampaignConvertedContactDTO),
  }
}

export function toCrmCampaignConvertedContactDTO(
  row: CrmCampaignConversion & { recipient: { name: string } | null },
): CrmCampaignConvertedContactDTO {
  return {
    id: row.id,
    kind: row.kind,
    channel: row.channel,
    recipientId: row.recipientId,
    name: row.recipient?.name ?? null,
    leadId: row.leadId,
    personId: row.personId,
    createdAt: row.createdAt.toISOString(),
  }
}

export function toCrmCampaignRecipientDTO(
  row: CrmCampaignRecipient,
): CrmCampaignRecipientDTO {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    waId: row.waId,
    personId: row.personId,
    leadId: row.leadId,
    emailStatus: row.emailStatus,
    emailSkipReason: row.emailSkipReason,
    emailError: row.emailError,
    emailSentAt: iso(row.emailSentAt),
    emailDeliveredAt: iso(row.emailDeliveredAt),
    emailOpenedAt: iso(row.emailOpenedAt),
    emailClickedAt: iso(row.emailClickedAt),
    emailBouncedAt: iso(row.emailBouncedAt),
    unsubscribedAt: iso(row.unsubscribedAt),
    whatsappStatus: row.whatsappStatus,
    whatsappSkipReason: row.whatsappSkipReason,
    whatsappError: row.whatsappError,
    whatsappSentAt: iso(row.whatsappSentAt),
    whatsappDeliveredAt: iso(row.whatsappDeliveredAt),
    whatsappReadAt: iso(row.whatsappReadAt),
    whatsappClickedAt: iso(row.whatsappClickedAt),
    whatsappRepliedAt: iso(row.whatsappRepliedAt),
    conversationId: row.conversationId,
    convertedAt: iso(row.convertedAt),
  }
}
