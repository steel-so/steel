import type { CrmCampaignDetailDTO } from '@/types/crm-campaign'

/** Fields the wizard edits — saved as one PATCH. */
export type CampaignDraft = Pick<
  CrmCampaignDetailDTO,
  | 'name'
  | 'utmMedium'
  | 'destinationType'
  | 'landingPageId'
  | 'formId'
  | 'siteId'
  | 'sitePageId'
  | 'emailFrom'
  | 'emailSubject'
  | 'emailPreheader'
  | 'emailTemplateId'
  | 'emailLegalBasis'
  | 'audience'
  | 'whatsappEnabled'
  | 'whatsappConnectionId'
  | 'whatsappTemplateId'
  | 'whatsappVariables'
  | 'whatsappText'
  | 'whatsappMediaUrl'
  | 'whatsappQuickReplyId'
  | 'whatsappDelayHours'
  | 'whatsappLegalBasis'
  | 'scheduledAt'
  | 'sendWindowStartHour'
  | 'sendWindowEndHour'
  | 'sendWeekdaysOnly'
>

export type DraftChange = (patch: Partial<CampaignDraft>) => void

export function draftFromCampaign(c: CrmCampaignDetailDTO): CampaignDraft {
  return {
    name: c.name,
    utmMedium: c.utmMedium,
    destinationType: c.destinationType,
    landingPageId: c.landingPageId,
    formId: c.formId,
    siteId: c.siteId,
    sitePageId: c.sitePageId,
    emailFrom: c.emailFrom,
    emailSubject: c.emailSubject,
    emailPreheader: c.emailPreheader,
    emailTemplateId: c.emailTemplateId,
    emailLegalBasis: c.emailLegalBasis,
    audience: c.audience,
    whatsappEnabled: c.whatsappEnabled,
    whatsappConnectionId: c.whatsappConnectionId,
    whatsappTemplateId: c.whatsappTemplateId,
    whatsappVariables: c.whatsappVariables,
    whatsappText: c.whatsappText,
    whatsappMediaUrl: c.whatsappMediaUrl,
    whatsappQuickReplyId: c.whatsappQuickReplyId,
    whatsappDelayHours: c.whatsappDelayHours,
    whatsappLegalBasis: c.whatsappLegalBasis,
    scheduledAt: c.scheduledAt,
    sendWindowStartHour: c.sendWindowStartHour,
    sendWindowEndHour: c.sendWindowEndHour,
    sendWeekdaysOnly: c.sendWeekdaysOnly,
  }
}

/** Empty strings become null so optional fields clear on the server. */
export function draftToPatch(draft: CampaignDraft): CampaignDraft {
  const blank = (value: string | null) =>
    value === null || value.trim() === '' ? null : value.trim()
  return {
    ...draft,
    emailFrom: blank(draft.emailFrom),
    emailSubject: blank(draft.emailSubject),
    emailPreheader: blank(draft.emailPreheader),
    whatsappText: draft.whatsappText?.trim() ? draft.whatsappText : null,
    whatsappMediaUrl: blank(draft.whatsappMediaUrl),
  }
}
