import type {
  CrmCampaign,
  CrmCampaignChannel,
  CrmCampaignConversionKind,
} from '@prisma/client'
import { logger } from '@/lib/axiom/logger'
import { BETTER_AUTH_URL } from '@/lib/env/server'
import { crmCampaignLinkInvalid } from '@/src/errors'
import {
  campaignDestinationUrl,
  withCampaignParams,
} from '@/src/lib/crm-campaign/campaign-url'
import { verifyCampaignLinkToken } from '@/src/lib/crm-campaign/tokens'
import { err, ok, type Result } from '@/src/lib/result'
import { CrmActivityRepository } from '@/src/repositories/crm-activity.repository'
import {
  CrmCampaignConversionRepository,
  CrmCampaignRecipientRepository,
  CrmCampaignRepository,
} from '@/src/repositories/crm-campaign.repository'
import { CrmCampaignLookupRepository } from '@/src/repositories/crm-campaign-lookup.repository'
import type {
  CrmCampaignRefDTO,
  ResendWebhookEvent,
} from '@/src/schemas/crm-campaign.schema'
import { resolveCampaignDestination } from './crm-campaign-destination'

/**
 * Funnel tracking of multichannel campaigns (ADR 0025): e-mail open pixel
 * and click redirect, Resend delivery events, WhatsApp status/replies from
 * the Comunicação webhooks, and conversions on the destination. Every
 * public entry point is best-effort — tracking never breaks the visitor's
 * page, the webhook or the form submission that triggered it.
 */

/** A reply counts for campaign messages sent in the last 30 days. */
const REPLY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Does a visit/submission belong to the campaign's destination?
 *
 * - landing page view → the campaign's landing page;
 * - CRM form page submission → the campaign's form;
 * - site page view → any page of the campaign's site (the visitor may land
 *   on it from a menu link carrying the parameters);
 * - form sent from a site page → the campaign's site, or the campaign's
 *   form embedded in some site page.
 */
export function matchesDestination(
  campaign: Pick<
    CrmCampaign,
    'destinationType' | 'landingPageId' | 'formId' | 'siteId'
  >,
  input: {
    kind: CrmCampaignConversionKind
    landingPageId?: string
    formId?: string
    siteId?: string
  },
): boolean {
  const type = campaign.destinationType
  switch (input.kind) {
    case 'LANDING_VIEW':
      return (
        type === 'LANDING_PAGE' &&
        campaign.landingPageId === input.landingPageId
      )
    case 'FORM_SUBMISSION':
      return type === 'FORM' && campaign.formId === input.formId
    case 'SITE_VIEW':
      return type === 'SITE_PAGE' && campaign.siteId === input.siteId
    case 'SITE_FORM_SUBMISSION':
      return (
        (type === 'SITE_PAGE' && campaign.siteId === input.siteId) ||
        (type === 'FORM' && campaign.formId === input.formId)
      )
  }
}

/**
 * Does it mark the recipient as converted? A form sent (from the form page
 * or a site page) converts form and site campaigns; a view converts landing
 * campaigns and site campaigns on their chosen page.
 */
export function convertsRecipient(
  campaign: Pick<CrmCampaign, 'destinationType' | 'sitePageId'>,
  input: { kind: CrmCampaignConversionKind; sitePageId?: string },
): boolean {
  switch (input.kind) {
    case 'LANDING_VIEW':
      return campaign.destinationType === 'LANDING_PAGE'
    case 'SITE_VIEW':
      return (
        campaign.destinationType === 'SITE_PAGE' &&
        campaign.sitePageId === input.sitePageId
      )
    default:
      return true
  }
}

function sourceChannel(value: string | undefined): CrmCampaignChannel | null {
  if (value === 'email') return 'EMAIL'
  if (value === 'whatsapp') return 'WHATSAPP'
  return null
}

export const CrmCampaignTrackingService = {
  /** Open pixel: first open of an e-mail recipient. */
  async recordOpen(token: string, now: Date): Promise<Result<boolean>> {
    const verified = verifyCampaignLinkToken(token)
    if (verified?.channel !== 'EMAIL') return ok(false)
    return CrmCampaignRecipientRepository.markFirst(
      { id: verified.recipientId },
      'emailOpenedAt',
      now,
    )
  },

  /**
   * Click on a campaign link: marks the click (and the open, for e-mail)
   * and returns the destination URL with the UTM parameters + the token.
   */
  async resolveClick(token: string, now: Date): Promise<Result<string>> {
    const verified = verifyCampaignLinkToken(token)
    if (!verified) return err(crmCampaignLinkInvalid())

    const recipient = await CrmCampaignRecipientRepository.findWithCampaign(
      verified.recipientId,
    )
    if (!recipient.ok) return recipient
    if (!recipient.value || recipient.value.campaign.deletedAt) {
      return err(crmCampaignLinkInvalid())
    }
    const { campaign } = recipient.value

    const destination = await resolveCampaignDestination(campaign)
    if (!destination.ok) return destination
    const ref = destination.value?.ref ?? null
    if (!ref || !campaign.destinationType) {
      return err(crmCampaignLinkInvalid())
    }

    const where = { id: verified.recipientId }
    if (verified.channel === 'EMAIL') {
      await CrmCampaignRecipientRepository.markFirst(
        where,
        'emailClickedAt',
        now,
      )
      await CrmCampaignRecipientRepository.markFirst(
        where,
        'emailOpenedAt',
        now,
      )
    } else {
      await CrmCampaignRecipientRepository.markFirst(
        where,
        'whatsappClickedAt',
        now,
      )
    }

    return ok(
      withCampaignParams(
        campaignDestinationUrl(
          BETTER_AUTH_URL,
          typeof ref === 'string'
            ? {
                type: campaign.destinationType as 'LANDING_PAGE' | 'FORM',
                token: ref,
              }
            : { type: 'SITE_PAGE', url: ref.url },
        ),
        {
          source: verified.channel === 'EMAIL' ? 'email' : 'whatsapp',
          medium: campaign.utmMedium,
          campaign: campaign.slug,
          ref: token,
        },
      ),
    )
  },

  /**
   * A visit (landing page, site page) or submission (form page, form on a
   * site page) arriving with campaign parameters. Attributed to the
   * recipient when the signed token matches, otherwise to the campaign by
   * its `utm_campaign` slug. The destination must be the campaign's (see
   * `matchesDestination`). Idempotent by `sourceRef`. Returns whether a
   * conversion was recorded.
   */
  async attribute(
    input: {
      workspaceId: string
      kind: CrmCampaignConversionKind
      sourceRef: string
      ref: CrmCampaignRefDTO
      landingPageId?: string
      formId?: string
      siteId?: string
      sitePageId?: string
      leadId?: string | null
      personId?: string | null
    },
    now: Date,
  ): Promise<Result<boolean>> {
    let campaign: CrmCampaign | null = null
    let recipientId: string | null = null
    let channel = sourceChannel(input.ref.utmSource)

    const verified = input.ref.ref
      ? verifyCampaignLinkToken(input.ref.ref)
      : null
    if (verified) {
      const recipient = await CrmCampaignRecipientRepository.findWithCampaign(
        verified.recipientId,
      )
      if (!recipient.ok) return recipient
      if (recipient.value) {
        campaign = recipient.value.campaign
        recipientId = recipient.value.id
        channel = verified.channel
      }
    }
    if (!campaign && input.ref.utmCampaign) {
      const bySlug = await CrmCampaignRepository.findBySlug(
        input.workspaceId,
        input.ref.utmCampaign,
      )
      if (!bySlug.ok) return bySlug
      campaign = bySlug.value
    }
    if (!campaign || campaign.workspaceId !== input.workspaceId)
      return ok(false)

    if (!matchesDestination(campaign, input)) return ok(false)

    const recorded = await CrmCampaignConversionRepository.record({
      campaignId: campaign.id,
      recipientId,
      channel,
      kind: input.kind,
      sourceRef: input.sourceRef,
      leadId: input.leadId ?? null,
      personId: input.personId ?? null,
      siteId: input.siteId ?? null,
      sitePageId: input.sitePageId ?? null,
      formId: input.formId ?? null,
    })
    if (!recorded.ok) return recorded
    if (recorded.value && recipientId && convertsRecipient(campaign, input)) {
      await CrmCampaignRecipientRepository.markFirst(
        { id: recipientId },
        'convertedAt',
        now,
      )
    }
    return ok(recorded.value !== null)
  },

  /**
   * A CRM form sent from a published site page (`site.form`): resolves the
   * site by its public slug (same workspace only) and attributes the
   * submission as SITE_FORM_SUBMISSION.
   */
  async attributeSiteForm(
    input: {
      workspaceId: string
      submissionId: string
      formId: string
      ref: CrmCampaignRefDTO
      leadId?: string | null
      personId?: string | null
    },
    now: Date,
  ): Promise<Result<boolean>> {
    const slug = input.ref.siteSlug
    if (!slug) return ok(false)
    const siteId = await CrmCampaignLookupRepository.findSiteIdBySlug(
      input.workspaceId,
      slug,
    )
    if (!siteId.ok) return siteId
    if (!siteId.value) return ok(false)
    return CrmCampaignTrackingService.attribute(
      {
        workspaceId: input.workspaceId,
        kind: 'SITE_FORM_SUBMISSION',
        sourceRef: input.submissionId,
        ref: input.ref,
        formId: input.formId,
        siteId: siteId.value,
        sitePageId: input.ref.sitePageId,
        leadId: input.leadId,
        personId: input.personId,
      },
      now,
    )
  },

  /** Resend webhook: delivery, bounce, complaint, open and click. */
  async onEmailEvent(
    event: ResendWebhookEvent,
    now: Date,
  ): Promise<Result<boolean>> {
    const recipient =
      await CrmCampaignRecipientRepository.findByProviderMessageId(
        'EMAIL',
        event.data.email_id,
      )
    if (!recipient.ok) return recipient
    if (!recipient.value) return ok(false)
    const where = { id: recipient.value.id }
    const R = CrmCampaignRecipientRepository

    switch (event.type) {
      case 'email.delivered':
        return R.markFirst(where, 'emailDeliveredAt', now)
      case 'email.opened':
        return R.markFirst(where, 'emailOpenedAt', now)
      case 'email.clicked':
        await R.markFirst(where, 'emailOpenedAt', now)
        return R.markFirst(where, 'emailClickedAt', now)
      case 'email.bounced':
        return R.markFirst(where, 'emailBouncedAt', now)
      case 'email.complained':
        return R.markFirst(where, 'unsubscribedAt', now)
      default:
        return ok(false)
    }
  },

  /** WhatsApp delivered/read from the provider webhooks. */
  async onWhatsAppStatus(
    providerMessageId: string,
    status: string,
    now: Date,
  ): Promise<Result<boolean>> {
    if (status !== 'DELIVERED' && status !== 'READ') return ok(false)
    const recipient =
      await CrmCampaignRecipientRepository.findByProviderMessageId(
        'WHATSAPP',
        providerMessageId,
      )
    if (!recipient.ok) return recipient
    if (!recipient.value) return ok(false)
    const where = { id: recipient.value.id }
    const delivered = await CrmCampaignRecipientRepository.markFirst(
      where,
      'whatsappDeliveredAt',
      now,
    )
    if (status === 'DELIVERED') return delivered
    return CrmCampaignRecipientRepository.markFirst(
      where,
      'whatsappReadAt',
      now,
    )
  },

  /**
   * An inbound WhatsApp message: if the number got a campaign message
   * recently, marks the reply, links the Comunicação conversation to the
   * recipient and logs it on the CRM person's timeline.
   */
  async onWhatsAppInbound(
    input: { workspaceId: string; waId: string; conversationId: string },
    now: Date,
  ): Promise<Result<boolean>> {
    const awaiting = await CrmCampaignRecipientRepository.listAwaitingReply(
      input.workspaceId,
      input.waId,
      new Date(now.getTime() - REPLY_WINDOW_MS),
    )
    if (!awaiting.ok) return awaiting
    const recipient = awaiting.value[0]
    if (!recipient) return ok(false)

    const marked = await CrmCampaignRecipientRepository.markReplied(
      recipient.id,
      { at: now, conversationId: input.conversationId },
    )
    if (!marked.ok) return marked

    if (recipient.personId) {
      await CrmActivityRepository.record({
        workspaceId: input.workspaceId,
        action: 'CAMPAIGN_REPLIED',
        entity: 'campaign',
        entityId: recipient.campaignId,
        personId: recipient.personId,
        summary: `respondeu pelo WhatsApp à campanha ${recipient.campaign.name}`,
      })
    }
    logger.info('crm.campaign.whatsapp_replied', {
      component: 'CrmCampaignTrackingService',
      campaignId: recipient.campaignId,
      recipientId: recipient.id,
    })
    return ok(true)
  },
}
